#!/usr/bin/env node
// Banc du mode oral (#20) : la même question, posée à l'écrit puis à l'oral.
//
// Par le VRAI protocole de l'agent (`agent.process` sur stdin, comme le pont
// Rust), derrière un proxy qui chronomètre Ollama. Chaque question part dans
// une conversation neuve, une fois sans `voiceMode`, une fois avec. On compare
// la forme (phrases par réponse, mots par phrase, Markdown, emoji, URL), les
// appels d'outils (le mode oral ne doit pas les faire baisser) et le premier
// token (les règles orales sont relues à chaque tour oral).
//
//   node scripts/oral-bench.mjs [--model qwen3:14b] [--ollama http://127.0.0.1:11434]
//
// Buts (veille du 11/11) : 3 phrases au plus, 18 mots par phrase en moyenne
// au plus, aucun Markdown, autant d'appels d'outils qu'à l'écrit. Prérequis :
// Ollama lancé, idéalement avec les réglages de prod (OLLAMA_KV_CACHE_TYPE=q4_0,
// OLLAMA_FLASH_ATTENTION=1). La revue de presse est coupée et les données vont
// dans un dossier temporaire : rien de réel n'est touché.

import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const OLLAMA = new URL(option('--ollama', 'http://127.0.0.1:11434'));
const MODEL = option('--model', 'qwen3:14b');
const sec = ms => `${(ms / 1000).toFixed(1)} s`;

// Des questions comme on les pose à voix haute ; les trois dernières appellent
// un outil (tous en risque low : aucune confirmation à donner).
const FIRST_TOOL_QUESTION = 9;
const QUESTIONS = [
  "C'est quoi la différence entre un virus et une bactérie ?",
  "Explique-moi comment marche l'inflation.",
  'Pourquoi le ciel est bleu ?',
  'Donne-moi des idées de dîner rapide pour ce soir.',
  'Combien de temps il faut pour aller sur Mars ?',
  "C'est quoi un ETF ?",
  'Comment je peux mieux dormir ?',
  'Résume-moi la Révolution française.',
  'Quelle heure est-il ?',
  "Qu'est-ce que disent les dailys sur l'intelligence artificielle ?",
  'Quelles sont mes tâches planifiées ?',
  'Quelles sont les actus tech du moment ?',
];

/** Forme d'une réponse : ce qu'une oreille entend mal. Pur. */
function forme(text) {
  const t = text.trim();
  const phrases = t
    .replace(/\n+/g, ' ')
    .split(/(?<=[.!?…])\s+/u)
    .map(p => p.trim())
    .filter(p => /\p{L}/u.test(p));
  const mots = phrases.map(p => p.split(/\s+/u).filter(Boolean).length);
  return {
    phrases: phrases.length,
    motsParPhrase: mots.length ? mots.reduce((a, b) => a + b, 0) / mots.length : 0,
    phraseMax: mots.length ? Math.max(...mots) : 0,
    markdown: /\*\*|__|^#{1,6} |^\s*[-*•] |^\s*\d+[.)] |`/mu.test(t),
    emoji: /\p{Extended_Pictographic}/u.test(t),
    url: /https?:\/\//u.test(t),
  };
}

// ─── Proxy chronométreur (même principe que latency-bench.mjs) ─────────────
const calls = [];
const proxy = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const call = { path: req.url, metrics: null };
    calls.push(call);
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
            if (j.total_duration) call.metrics = j;
          } catch {
            // réponse non NDJSON : pas de métriques
          }
        });
      },
    );
    res.on('close', () => {
      if (!res.writableEnded) upstream.destroy();
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

// ─── Agent ─────────────────────────────────────────────────────────────────
// Un agent NEUF par mode, avec son propre dossier de données : sinon la
// mémoire entre conversations (`rememberExchange`) ressert la réponse de
// l'autre mode comme « souvenir pertinent », et le modèle la recopie.
const agentDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'agent-runtime');

async function startAgent() {
  const dataDir = mkdtempSync(join(tmpdir(), 'catdesk-oral-bench-'));
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
  const state = { current: null };
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
        continue;
      }
      const step = msg.params?.step;
      const current = state.current;
      if (!current || !step) continue;
      if (step.type === 'token') {
        current.first ||= Date.now();
        current.text += step.content ?? '';
      } else if (step.type === 'tool_start') {
        current.tools.push(step.toolName);
      } else if (step.type === 'done') {
        current.final = step.content ?? current.text;
      }
    }
  });

  let nextId = 1;
  const rpc = (method, params) => {
    const id = `oral-${nextId++}`;
    agent.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    return new Promise(resolve => pending.set(id, resolve));
  };

  await waitForLog('Agent Runtime ready');
  await rpc('agent.warmup', { model: MODEL });
  await waitForLog('Model warmed up');

  const ask = async (input, voiceMode, n) => {
    const before = calls.length;
    state.current = { t0: Date.now(), first: 0, text: '', final: '', tools: [] };
    await rpc('agent.process', {
      input,
      conversationId: `oral-bench-${n}`,
      messageId: `m-${nextId}`,
      config: {
        model: MODEL,
        temperature: 0.2,
        maxIterations: 4,
        ...(voiceMode ? { voiceMode } : {}),
      },
    });
    const r = state.current;
    state.current = null;
    const chat = calls.slice(before).find(c => c.path === '/api/chat' && c.metrics)?.metrics;
    return {
      first: r.first ? r.first - r.t0 : NaN,
      total: Date.now() - r.t0,
      promptTokens: chat?.prompt_eval_count,
      tools: r.tools,
      text: r.final || r.text,
    };
  };

  const stop = async () => {
    agent.stdin.end();
    await new Promise(resolve => agent.on('exit', resolve));
    rmSync(dataDir, { recursive: true, force: true });
  };
  return { ask, stop };
}

console.log(`Modèle ${MODEL}, Ollama ${OLLAMA.origin}\n`);
const runs = { ecrit: [], oral: [] };
for (const voiceMode of [false, true]) {
  const agent = await startAgent();
  for (const [n, input] of QUESTIONS.entries()) {
    const r = await agent.ask(input, voiceMode, n);
    const f = forme(r.text);
    runs[voiceMode ? 'oral' : 'ecrit'].push({ input, n, ...r, ...f });
    console.log(
      `${voiceMode ? 'ORAL ' : 'écrit'} ${sec(r.first).padStart(6)} · ${String(f.phrases).padStart(2)} phrases · ` +
        `${f.motsParPhrase.toFixed(0).padStart(2)} mots/phrase · outils [${r.tools.join(', ')}]` +
        `${f.markdown ? ' · MARKDOWN' : ''}${f.emoji ? ' · emoji' : ''}${f.url ? ' · URL' : ''}  ${input}`,
    );
    console.log(`      → ${JSON.stringify(r.text).slice(0, 220)}`);
  }
  await agent.stop();
}
proxy.close();

const median = xs => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? NaN;
};
const mean = xs => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
console.log('\n                      écrit     oral');
const row = (label, f) =>
  console.log(`${label.padEnd(22)}${f(runs.ecrit).padStart(5)}${f(runs.oral).padStart(9)}`);
row('phrases (moyenne)', r => mean(r.map(x => x.phrases)).toFixed(1));
row('réponses ≤ 3 phrases', r => `${r.filter(x => x.phrases <= 3).length}/${r.length}`);
row('mots par phrase', r => mean(r.map(x => x.motsParPhrase)).toFixed(1));
row('phrase la plus longue', r => String(Math.max(...r.map(x => x.phraseMax))));
row('avec Markdown', r => `${r.filter(x => x.markdown).length}/${r.length}`);
row('avec emoji ou URL', r => `${r.filter(x => x.emoji || x.url).length}/${r.length}`);
row("appels d'outils", r => String(r.reduce((a, x) => a + x.tools.length, 0)));
row('premier token médian', r => sec(median(r.map(x => x.first))));
row('  …sans outil (9 q.)', r =>
  sec(median(r.filter(x => x.n < FIRST_TOOL_QUESTION).map(x => x.first))),
);
row('réponse complète méd.', r => sec(median(r.map(x => x.total))));
row('tokens de prompt méd.', r => String(median(r.map(x => x.promptTokens ?? NaN))));
