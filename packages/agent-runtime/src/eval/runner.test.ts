import { createServer, type Server } from 'http';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { AddressInfo } from 'net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EvalTask } from './evalTasks';
import { createHarness, runAttempt, serverLooksDown } from './runner';

type ChatLine = Record<string, unknown>;

/** Faux Ollama : rejoue une réponse par requête, et garde les corps reçus. */
function fakeOllama(script: ChatLine[]): { server: Server; bodies: ChatLine[] } {
  const bodies: ChatLine[] = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => (raw += String(chunk)));
    req.on('end', () => {
      bodies.push(JSON.parse(raw) as ChatLine);
      const line = script.shift() ?? { message: { content: 'plus rien' } };
      res.end(`${JSON.stringify({ ...line, done: true })}\n`);
    });
  });
  return { server, bodies };
}

const toolCall = (name: string, args: Record<string, unknown>): ChatLine => ({
  message: { content: '', tool_calls: [{ function: { name, arguments: args } }] },
});

const mailTask: EvalTask = {
  id: 'mail',
  split: 'dev',
  category: 'mails',
  input: 'lis mes derniers mails',
  tools: ['read_email'],
  answer: /82,40/,
};

describe('arrêt du banc quand le serveur tombe', () => {
  const ok = {};
  const failed = { error: 'Ollama non disponible' };

  it("s'arrête après trois erreurs d'affilée", () => {
    expect(serverLooksDown([ok, failed, failed, failed])).toBe(true);
  });

  it('continue sur des erreurs isolées, comme une réponse vide', () => {
    expect(serverLooksDown([failed, failed, ok, failed])).toBe(false);
    expect(serverLooksDown([failed, failed])).toBe(false);
  });
});

describe('banc de bout en bout (faux Ollama)', () => {
  let dataDir: string;

  beforeAll(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'catdesk-eval-test-'));
    process.env['CATDESK_DATA_DIR'] = dataDir;
  });

  afterAll(() => {
    delete process.env['CATDESK_DATA_DIR'];
    rmSync(dataDir, { recursive: true, force: true });
  });

  async function play(script: ChatLine[], task: EvalTask) {
    const { server, bodies } = fakeOllama(script);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const harness = createHarness(`http://127.0.0.1:${port}`);
      const attempt = await runAttempt(harness, task, { model: 'faux' }, 1);
      return { attempt, bodies };
    } finally {
      server.close();
    }
  }

  it("joue un appel d'outil avec le monde simulé, puis note la réponse", async () => {
    const { attempt, bodies } = await play(
      [toolCall('read_email', {}), { message: { content: 'Facture EDF : 82,40 €.' } }],
      mailTask,
    );

    expect(attempt.calls).toEqual([{ name: 'read_email', args: {}, valid: true }]);
    expect(attempt.score.passed).toBe(true);

    // Le résultat renvoyé au modèle vient bien du monde simulé.
    expect(JSON.stringify(bodies[1])).toContain('82,40');
  });

  it('propose au modèle les outils retenus par la vraie sélection', async () => {
    const { attempt, bodies } = await play([{ message: { content: 'Ok.' } }], mailTask);
    const sent = (bodies[0]?.['tools'] as { function: { name: string } }[]).map(
      t => t.function.name,
    );
    expect(sent).toEqual(attempt.selected);
    expect(sent).toContain('read_email');
  });

  it('une conversation ne déborde pas sur la suivante', async () => {
    const { bodies } = await play(
      [{ message: { content: 'Première.' } }, { message: { content: 'Seconde.' } }],
      mailTask,
    );
    const messages = bodies[0]?.['messages'] as { role: string }[];
    expect(messages.filter(m => m.role === 'assistant')).toEqual([]);
  });

  it("un outil qui n'est pas attendu fait échouer la tâche", async () => {
    const { attempt } = await play(
      [toolCall('run_command', { command: 'dir' }), { message: { content: 'Fait.' } }],
      mailTask,
    );
    expect(attempt.score.called).toBe(false);
    expect(attempt.score.sideEffects).toEqual(['run_command']);
  });
});
