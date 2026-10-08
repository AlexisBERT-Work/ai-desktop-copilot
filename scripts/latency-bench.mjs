#!/usr/bin/env node
// Banc de latence de l'agent CatDesk.
//
// Mesure le premier token par le VRAI protocole de l'agent (JSON-RPC sur
// stdin, comme le pont Rust), derrière un proxy qui chronomètre chaque appel à
// Ollama : chargement du modèle, lecture du prompt, génération. C'est l'outil
// qui a trouvé les causes de la passe du 2026-10-08 (docs/SUIVI.md).
//
//   node scripts/latency-bench.mjs [--cold] [--no-warmup] [--model qwen3:14b]
//                                  [--ollama http://127.0.0.1:11434]
//
// --cold       décharge le modèle avant de commencer (lancement de CatDesk)
// --no-warmup  n'envoie pas agent.warmup (ce que ferait l'ouverture du chat)
//
// Prérequis : Ollama lancé, idéalement avec les réglages de prod
// (OLLAMA_KV_CACHE_TYPE=q4_0 et OLLAMA_FLASH_ATTENTION=1, voir core/ollama.rs) —
// sans eux, tout est ~2x plus lent qu'une fois installé. La revue de presse est
// coupée pendant la mesure et les données de l'agent vont dans un dossier
// temporaire : rien de réel n'est touché.

import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const flag = name => args.includes(name);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const OLLAMA = new URL(option('--ollama', 'http://127.0.0.1:11434'));
const MODEL = option('--model', 'qwen3:14b');
const QUESTIONS = [
  'Réponds en une seule phrase courte : quelle est la capitale de la France ?',
  "Et celle de l'Italie ? Même format.",
  'Quelle était ma toute première question dans cette conversation ? Une phrase.',
];
const agentDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'agent-runtime');
const sec = ms => `${(ms / 1000).toFixed(1)} s`;

// ─── Proxy chronométreur ───────────────────────────────────────────────────
const started = Date.now();
const calls = [];
const proxy = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const call = { at: Date.now() - started, path: req.url, info: '', result: '' };
    try {
      const j = JSON.parse(body.toString('utf8') || '{}');
      call.info = `${j.model ?? ''} num_ctx=${j.options?.num_ctx ?? '-'} outils=${j.tools?.length ?? 0}`;
    } catch {
      // corps non JSON (GET) : rien à décrire
    }
    calls.push(call);
    const t = Date.now();
    const upstream = http.request(
      {
        host: OLLAMA.hostname,
        port: OLLAMA.port,
        method: req.method,
        path: req.url,
        headers: req.headers,
      },
      upRes => {
        res.writeHead(upRes.statusCode ?? 502, upRes.headers);
        let tail = '';
        upRes.on('data', c => {
          tail = (tail + c.toString('utf8')).slice(-1500);
          res.write(c);
        });
        upRes.on('end', () => {
          res.end();
          try {
            const j = JSON.parse(tail.trim().split('\n').pop() ?? '');
            if (j.total_duration) {
              call.result =
                `chargement ${sec(j.load_duration / 1e6)} · prompt ${j.prompt_eval_count} tok ` +
                `en ${sec(j.prompt_eval_duration / 1e6)} · ${j.eval_count} tok générés`;
            }
          } catch {
            // réponse non NDJSON : pas de métriques
          }
          call.result ||= `${sec(Date.now() - t)}`;
        });
      },
    );
    // L'agent annule (Stop, préemption du travail de fond) → couper aussi vers
    // Ollama, comme une connexion directe. Sans ça, le proxy fausserait tout.
    res.on('close', () => {
      if (!res.writableEnded) {
        call.result = 'ANNULÉ par l’agent';
        upstream.destroy();
      }
    });
    upstream.on('error', e => {
      res.writeHead(502);
      res.end(String(e));
    });
    upstream.end(body);
  });
});
await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
const proxyPort = proxy.address().port;

if (flag('--cold')) {
  await fetch(new URL('/api/generate', OLLAMA), {
    method: 'POST',
    body: JSON.stringify({ model: MODEL, keep_alive: 0 }),
  }).catch(() => undefined);
}

// ─── Agent ─────────────────────────────────────────────────────────────────
const dataDir = mkdtempSync(join(tmpdir(), 'catdesk-bench-'));
const agent = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
  cwd: agentDir,
  env: {
    ...process.env,
    CATDESK_DATA_DIR: dataDir,
    OLLAMA_URL: `http://127.0.0.1:${proxyPort}`,
    CATDESK_PRESS_DIGEST: '0',
  },
  stdio: ['pipe', 'pipe', 'pipe'],
});

const logLines = [];
agent.stderr.setEncoding('utf8');
agent.stderr.on('data', d => logLines.push(...d.split('\n')));
const waitForLog = async needle => {
  while (!logLines.some(l => l.includes(needle))) await new Promise(r => setTimeout(r, 100));
};

const pending = new Map();
let current = null;
let buffer = '';
agent.stdout.setEncoding('utf8');
agent.stdout.on('data', d => {
  buffer += d;
  const lines = buffer.split('\n');
  buffer = lines.pop() ?? '';
  for (const line of lines) {
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else if (current && msg.params?.step?.type === 'token') {
      current.first ||= Date.now();
      current.text += msg.params.step.content ?? '';
    }
  }
});

let nextId = 1;
const rpc = (method, params) => {
  const id = `bench-${nextId++}`;
  agent.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  return new Promise(resolve => pending.set(id, resolve));
};

await waitForLog('Agent Runtime ready');
console.log(`Agent prêt — modèle ${MODEL}, Ollama ${OLLAMA.origin} (via proxy :${proxyPort})\n`);

if (!flag('--no-warmup')) {
  const t = Date.now();
  await rpc('agent.warmup', { model: MODEL });
  await waitForLog('Model warmed up');
  console.log(`Préchauffage (ouverture du chat) : ${sec(Date.now() - t)}, pendant la saisie\n`);
}

const conversationId = `bench-${Date.now()}`;
const results = [];
for (const input of QUESTIONS) {
  current = { t0: Date.now(), first: 0, text: '' };
  await rpc('agent.process', {
    input,
    conversationId,
    messageId: `m-${nextId}`,
    config: { model: MODEL, temperature: 0.2, maxIterations: 4 },
  });
  const r = current;
  current = null;
  results.push({ input, first: r.first ? r.first - r.t0 : NaN, text: r.text });
}

agent.stdin.end();
await new Promise(resolve => agent.on('exit', resolve));
proxy.close();
rmSync(dataDir, { recursive: true, force: true });

console.log('Premier token par question :');
for (const r of results) {
  console.log(
    `  ${sec(r.first).padStart(7)}  ${r.input}\n           → ${JSON.stringify(r.text).slice(0, 100)}`,
  );
}
console.log('\nAppels à Ollama :');
for (const c of calls.filter(c => c.path !== '/api/tags')) {
  console.log(`  ${sec(c.at).padStart(7)}  ${c.path.padEnd(16)} ${c.info.padEnd(36)} ${c.result}`);
}
