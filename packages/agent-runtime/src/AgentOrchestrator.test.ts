import { describe, it, expect, vi } from 'vitest';
import { AgentOrchestrator } from './AgentOrchestrator';
import type { OllamaClient } from './llm/OllamaClient';
import type { ToolRegistry } from './ToolRegistry';
import type { PermissionEngine } from './permissions/PermissionEngine';
import type { ContextManager } from './ContextManager';
import type { AuditLogger } from './AuditLogger';
import type { PlaybookStore } from './playbook/PlaybookStore';
import type { SemanticCache } from './memory/SemanticCache';
import type {
  AgentConfig,
  AgentStep,
  OllamaMessage,
  StreamChunk,
  ToolResult,
} from '@catdesk/shared-types';

// ─── Harnais : orchestrateur câblé sur des fakes scriptables ───────────────

const token = (content: string): StreamChunk => ({ type: 'token', content });
const nativeCall = (name: string, args: Record<string, unknown>, id = 'call-1'): StreamChunk => ({
  type: 'tool_call',
  toolCall: { id, type: 'function', function: { name, arguments: args } },
});

interface HarnessOptions {
  /** Tours LLM scriptés : un tableau de chunks par appel streamChat. */
  turns?: StreamChunk[][];
  /** Historique préexistant (non vide → la requête n'est plus "standalone"). */
  priorMessages?: OllamaMessage[];
  granted?: boolean;
  reason?: string;
  toolResult?: ToolResult;
  toolThrows?: string;
  /** Active un cache sémantique ; `cacheHit` fait répondre lookup(). */
  withCache?: boolean;
  cacheHit?: string;
}

function makeHarness(opts: HarnessOptions = {}) {
  const turns = opts.turns ?? [];
  let turnIndex = 0;
  const llmCalls: Array<{ model: string; messages: OllamaMessage[]; system?: string }> = [];
  const llm = {
    async *streamChat(params: { model: string; messages: OllamaMessage[]; system?: string }) {
      llmCalls.push(params);
      const turn = turns[turnIndex++];
      if (!turn) throw new Error('streamChat appelé plus souvent que scripté');
      for (const chunk of turn) yield chunk;
    },
  } as unknown as OllamaClient;

  const executeTool = vi.fn(async (_name: string, args: unknown): Promise<ToolResult> => {
    if (opts.toolThrows) throw new Error(opts.toolThrows);
    return opts.toolResult ?? { success: true, data: { echoed: args } };
  });
  const tools = {
    getEnabled: () => [
      {
        name: 'echo',
        description: 'Renvoie ses arguments (outil de test)',
        category: 'system',
        riskLevel: 'low',
        toOllamaSchema: () => ({
          type: 'function',
          function: { name: 'echo', description: 'Echo', parameters: { type: 'object' } },
        }),
      },
    ],
    execute: executeTool,
  } as unknown as ToolRegistry;

  const check = vi.fn(async () =>
    opts.granted === false
      ? { granted: false, reason: opts.reason ?? 'refusé' }
      : { granted: true },
  );
  const permissions = { check } as unknown as PermissionEngine;

  const recordTurn = vi.fn();
  const rememberExchange = vi.fn(async () => {});
  const context = {
    buildContext: async () => ({ messages: opts.priorMessages ?? [] }),
    recordTurn,
    rememberExchange,
  } as unknown as ContextManager;

  const startRun = vi.fn();
  const completeRun = vi.fn();
  const logToolCall = vi.fn();
  const audit = { startRun, completeRun, logToolCall } as unknown as AuditLogger;

  const playbookRecord = vi.fn();
  const playbook = { bestApproach: () => null, record: playbookRecord } as unknown as PlaybookStore;

  const cachePut = vi.fn(async () => {});
  const cache = opts.withCache
    ? ({
        lookup: async () =>
          opts.cacheHit !== undefined
            ? { answer: opts.cacheHit, similarity: 0.97, exact: false }
            : null,
        put: cachePut,
      } as unknown as SemanticCache)
    : undefined;

  const orchestrator = new AgentOrchestrator(
    llm,
    tools,
    permissions,
    context,
    audit,
    undefined, // smallModel
    undefined, // planner
    undefined, // activity
    undefined, // idleUnloader
    undefined, // factExtractor
    undefined, // compactor
    playbook,
    cache,
  );

  return {
    orchestrator,
    llmCalls,
    executeTool,
    check,
    recordTurn,
    rememberExchange,
    completeRun,
    logToolCall,
    playbookRecord,
    cachePut,
  };
}

async function collect(gen: AsyncGenerator<AgentStep>): Promise<AgentStep[]> {
  const steps: AgentStep[] = [];
  for await (const s of gen) steps.push(s);
  return steps;
}

const CONFIG: AgentConfig = { model: 'qwen3:14b' };

// ─── Réponse directe (sans outil) ───────────────────────────────────────────

describe('AgentOrchestrator — réponse directe', () => {
  it('streame les tokens puis émet done avec la réponse complète', async () => {
    const h = makeHarness({ turns: [[token('Bon'), token('jour !')]] });
    const steps = await collect(h.orchestrator.process('salut', 'conv-1', CONFIG));

    expect(steps).toEqual([
      { type: 'token', content: 'Bon' },
      { type: 'token', content: 'jour !' },
      { type: 'done', content: 'Bonjour !' },
    ]);
    expect(h.llmCalls[0]?.model).toBe('qwen3:14b');
    expect(h.llmCalls[0]?.messages.at(-1)).toEqual({ role: 'user', content: 'salut' });
  });

  it('persiste le tour, audite le succès et enregistre le playbook', async () => {
    const h = makeHarness({ turns: [[token('réponse')]] });
    await collect(h.orchestrator.process('salut', 'conv-1', CONFIG));

    expect(h.completeRun).toHaveBeenCalledWith(expect.any(String), 'success', 'réponse');
    expect(h.recordTurn).toHaveBeenCalledWith('conv-1', 'qwen3:14b', 'salut', 'réponse');
    expect(h.rememberExchange).toHaveBeenCalledWith('conv-1', 'salut', 'réponse');
    expect(h.playbookRecord).toHaveBeenCalledWith(expect.any(String), expect.any(String), true);
  });

  it('rejoue tel quel un début de JSON retenu qui ne cachait pas de tool call', async () => {
    // Ouvre comme un tool call texte → retenu du stream live ; aucun outil connu
    // ne correspond → flush en un seul token à la fin (l'UI ne reste pas vide).
    const text = '{"name": "outil_inconnu", "arguments": {}}';
    const h = makeHarness({ turns: [[token(text)]] });
    const steps = await collect(h.orchestrator.process('salut', 'conv-1', CONFIG));

    expect(steps).toEqual([
      { type: 'token', content: text },
      { type: 'done', content: text },
    ]);
    expect(h.executeTool).not.toHaveBeenCalled();
  });
});

// ─── Cache sémantique (§E) ──────────────────────────────────────────────────

describe('AgentOrchestrator — cache sémantique', () => {
  it('sert un hit sans appeler le LLM (requête standalone)', async () => {
    const h = makeHarness({ withCache: true, cacheHit: 'la réponse est 42', turns: [] });
    const steps = await collect(h.orchestrator.process('question ?', 'conv-1', CONFIG));

    expect(steps).toEqual([
      { type: 'token', content: 'la réponse est 42' },
      { type: 'done', content: 'la réponse est 42' },
    ]);
    expect(h.llmCalls).toHaveLength(0);
    expect(h.completeRun).toHaveBeenCalledWith(expect.any(String), 'success', 'la réponse est 42');
    expect(h.recordTurn).toHaveBeenCalledWith(
      'conv-1',
      'qwen3:14b',
      'question ?',
      'la réponse est 42',
    );
  });

  it('mémorise une réponse standalone sans outil', async () => {
    const h = makeHarness({ withCache: true, turns: [[token('quatre')]] });
    await collect(h.orchestrator.process('2+2 ?', 'conv-1', CONFIG));
    expect(h.cachePut).toHaveBeenCalledWith('2+2 ?', 'quatre');
  });

  it('ne consulte ni ne remplit le cache pour une question de suivi', async () => {
    const h = makeHarness({
      withCache: true,
      cacheHit: 'vieille réponse', // un lookup répondrait — il ne doit pas avoir lieu
      priorMessages: [
        { role: 'user', content: 'avant' },
        { role: 'assistant', content: 'ok' },
      ],
      turns: [[token('suite')]],
    });
    const steps = await collect(h.orchestrator.process('et ensuite ?', 'conv-1', CONFIG));

    expect(steps.at(-1)).toEqual({ type: 'done', content: 'suite' });
    expect(h.cachePut).not.toHaveBeenCalled();
  });
});

// ─── Boucle d'outils ────────────────────────────────────────────────────────

describe('AgentOrchestrator — exécution des outils', () => {
  it('exécute un tool call natif puis rejoue le résultat au LLM', async () => {
    const h = makeHarness({
      turns: [[nativeCall('echo', { x: 1 })], [token('fini')]],
    });
    const steps = await collect(h.orchestrator.process('utilise echo', 'conv-1', CONFIG));

    expect(steps.map(s => s.type)).toEqual(['tool_start', 'tool_result', 'token', 'done']);
    expect(h.executeTool).toHaveBeenCalledWith('echo', { x: 1 });
    expect(h.logToolCall).toHaveBeenCalledTimes(1);

    // Le 2ᵉ appel LLM rejoue l'assistant (arguments en OBJET) puis le message tool.
    const replay = h.llmCalls[1]?.messages ?? [];
    const assistant = replay.find(m => m.role === 'assistant');
    expect(assistant?.tool_calls?.[0]?.function).toEqual({ name: 'echo', arguments: { x: 1 } });
    const toolMsg = replay.find(m => m.role === 'tool');
    expect(toolMsg).toEqual({
      role: 'tool',
      content: JSON.stringify({ echoed: { x: 1 } }),
      tool_call_id: 'call-1',
    });
  });

  it("ne met pas en cache une réponse obtenue via un outil et signe l'approche", async () => {
    const h = makeHarness({
      withCache: true,
      turns: [[nativeCall('echo', { x: 1 })], [token('fini')]],
    });
    await collect(h.orchestrator.process('utilise echo', 'conv-1', CONFIG));

    expect(h.cachePut).not.toHaveBeenCalled();
    expect(h.playbookRecord).toHaveBeenCalledWith(expect.any(String), 'echo', true);
  });

  it('bloque un outil refusé et transmet le refus au LLM sans exécuter', async () => {
    const h = makeHarness({
      granted: false,
      reason: 'trop risqué',
      turns: [[nativeCall('echo', { x: 1 })], [token("d'accord")]],
    });
    const steps = await collect(h.orchestrator.process('utilise echo', 'conv-1', CONFIG));

    expect(steps).toContainEqual({ type: 'tool_blocked', toolName: 'echo', reason: 'trop risqué' });
    expect(h.executeTool).not.toHaveBeenCalled();
    const toolMsg = (h.llmCalls[1]?.messages ?? []).find(m => m.role === 'tool');
    expect(toolMsg?.content).toContain('Permission denied: trop risqué');
  });

  it("relaie l'échec d'un outil qui jette sans casser la boucle", async () => {
    const h = makeHarness({
      toolThrows: 'boom',
      turns: [[nativeCall('echo', { x: 1 })], [token('échec géré')]],
    });
    const steps = await collect(h.orchestrator.process('utilise echo', 'conv-1', CONFIG));

    expect(steps).toContainEqual({ type: 'tool_error', toolName: 'echo', error: 'boom' });
    const toolMsg = (h.llmCalls[1]?.messages ?? []).find(m => m.role === 'tool');
    expect(toolMsg?.content).toBe(JSON.stringify({ error: 'boom' }));
    expect(steps.at(-1)).toEqual({ type: 'done', content: 'échec géré' });
  });

  it('récupère et exécute un tool call émis en texte (<tool_call>)', async () => {
    const h = makeHarness({
      turns: [
        [token('<tool_call>{"name": "echo", "arguments": {"x": 2}}</tool_call>')],
        [token('fait')],
      ],
    });
    const steps = await collect(h.orchestrator.process('utilise echo', 'conv-1', CONFIG));

    expect(steps.map(s => s.type)).toEqual(['tool_start', 'tool_result', 'token', 'done']);
    expect(h.executeTool).toHaveBeenCalledWith('echo', { x: 2 });
  });
});

// ─── Fins de run anormales ──────────────────────────────────────────────────

describe('AgentOrchestrator — fins de run', () => {
  it('clôt le run en erreur sur un chunk error du LLM', async () => {
    const h = makeHarness({
      turns: [[token('déb'), { type: 'error', error: 'connexion perdue' }]],
    });
    const steps = await collect(h.orchestrator.process('salut', 'conv-1', CONFIG));

    expect(steps).toEqual([
      { type: 'token', content: 'déb' },
      { type: 'error', content: 'connexion perdue' },
    ]);
    expect(h.completeRun).toHaveBeenCalledWith(expect.any(String), 'error');
  });

  it("s'arrête net (audit « interrupted ») quand le signal est déjà annulé", async () => {
    const h = makeHarness({ turns: [] });
    const controller = new AbortController();
    controller.abort();
    const steps = await collect(
      h.orchestrator.process('salut', 'conv-1', CONFIG, controller.signal),
    );

    expect(steps).toEqual([]);
    expect(h.llmCalls).toHaveLength(0);
    expect(h.completeRun).toHaveBeenCalledWith(expect.any(String), 'interrupted');
  });

  it("émet MAX_ITERATIONS et enregistre l'échec au playbook quand la boucle ne converge pas", async () => {
    const h = makeHarness({
      turns: [[nativeCall('echo', { n: 1 }, 'c1')], [nativeCall('echo', { n: 2 }, 'c2')]],
    });
    const steps = await collect(
      h.orchestrator.process('boucle', 'conv-1', { ...CONFIG, maxIterations: 2 }),
    );

    const last = steps.at(-1);
    expect(last?.type).toBe('error');
    expect(last && 'code' in last ? last.code : undefined).toBe('MAX_ITERATIONS');
    expect(h.completeRun).toHaveBeenCalledWith(expect.any(String), 'max_iterations');
    expect(h.playbookRecord).toHaveBeenCalledWith(expect.any(String), 'echo', false);
  });
});
