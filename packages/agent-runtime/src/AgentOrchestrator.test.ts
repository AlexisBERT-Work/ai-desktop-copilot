import { describe, it, expect, vi } from 'vitest';
import { AgentOrchestrator, parseToolArgs } from './AgentOrchestrator';
import type { OllamaClient } from './llm/OllamaClient';
import type { ToolRegistry } from './ToolRegistry';
import type { PermissionEngine } from './permissions/PermissionEngine';
import type { ContextManager } from './ContextManager';
import type { AuditLogger } from './AuditLogger';
import type { PlaybookStore } from './playbook/PlaybookStore';
import type { SemanticCache } from './memory/SemanticCache';
import type { FactExtractor } from './memory/FactExtractor';
import { LlmScheduler } from './llm/LlmScheduler';
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
  /** Mémoire long terme (prompt système) et souvenirs du tour (dernier message). */
  warmFacts?: string[];
  relevantMemories?: string[];
  scheduler?: LlmScheduler;
  withFactExtractor?: boolean;
  /** Outils exposés (défaut : le seul outil echo). */
  toolDefs?: Array<{ name: string; description: string }>;
}

function makeHarness(opts: HarnessOptions = {}) {
  const turns = opts.turns ?? [];
  let turnIndex = 0;
  const llmCalls: Array<{
    model: string;
    messages: OllamaMessage[];
    system?: string;
    tools?: unknown[];
    maxTokens?: number;
  }> = [];
  const llm = {
    async *streamChat(params: (typeof llmCalls)[number]) {
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
  const mkTool = (name: string, description: string) => ({
    name,
    description,
    category: 'test',
    riskLevel: 'low',
    toOllamaSchema: () => ({ type: 'function', function: { name, description, parameters: {} } }),
  });
  const tools = {
    getEnabled: () =>
      opts.toolDefs?.map(t => mkTool(t.name, t.description)) ?? [
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
    filesystemTargets: () => [],
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
    buildContext: async () => ({
      messages: opts.priorMessages ?? [],
      ...(opts.warmFacts ? { warmFacts: opts.warmFacts } : {}),
      ...(opts.relevantMemories ? { relevantMemories: opts.relevantMemories } : {}),
    }),
    getWarmFacts: () => opts.warmFacts ?? [],
    history: () => ({ messages: opts.priorMessages ?? [] }),
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

  const extractAndStore = vi.fn(async () => 0);
  const factExtractor = opts.withFactExtractor
    ? ({ extractAndStore } as unknown as FactExtractor)
    : undefined;

  const orchestrator = new AgentOrchestrator({
    llm,
    tools,
    permissions,
    context,
    audit,
    playbook,
    cache,
    factExtractor,
    scheduler: opts.scheduler,
  });

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
    extractAndStore,
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
    // Le dernier message porte le contexte du tour (date…), puis la demande intacte.
    const last = h.llmCalls[0]?.messages.at(-1);
    expect(last?.role).toBe('user');
    expect(last?.content.startsWith('[Contexte]\nDate et heure actuelles : ')).toBe(true);
    expect(last?.content.endsWith('salut')).toBe(true);
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

  it('un Stop pendant le flux ne finalise pas la réponse tronquée (ni cache, ni done)', async () => {
    const controller = new AbortController();
    const h = makeHarness({ withCache: true, turns: [] });
    // Flux qui s'interrompt au milieu, comme OllamaClient quand le signal tombe.
    (h.orchestrator as unknown as { deps: { llm: OllamaClient } }).deps.llm = {
      async *streamChat() {
        yield token('début de rép');
        controller.abort();
      },
    } as unknown as OllamaClient;

    const steps = await collect(
      h.orchestrator.process('question', 'conv-1', CONFIG, controller.signal),
    );

    expect(steps).toEqual([{ type: 'token', content: 'début de rép' }]);
    expect(h.cachePut).not.toHaveBeenCalled();
    expect(h.recordTurn).not.toHaveBeenCalled();
    expect(h.completeRun).toHaveBeenCalledWith(expect.any(String), 'interrupted');
  });

  it('transforme une erreur interne en étape error (code INTERNAL), auditée', async () => {
    const h = makeHarness({ turns: [] });
    (h.orchestrator as unknown as { deps: { context: ContextManager } }).deps.context.buildContext =
      async () => {
        throw new Error('base illisible');
      };

    const steps = await collect(h.orchestrator.process('salut', 'conv-1', CONFIG));

    expect(steps).toEqual([
      {
        type: 'error',
        content: "Erreur interne de l'agent : base illisible",
        code: 'INTERNAL',
      },
    ]);
    expect(h.completeRun).toHaveBeenCalledWith(expect.any(String), 'error');
  });

  it("des arguments d'outil en JSON invalide deviennent {} au lieu de faire tomber le run", async () => {
    const h = makeHarness({
      turns: [
        [
          {
            type: 'tool_call',
            toolCall: {
              id: 'c1',
              type: 'function',
              function: { name: 'echo', arguments: '{"x": 1, tronqué' },
            },
          },
        ],
        [token('ok')],
      ],
    });
    const steps = await collect(h.orchestrator.process('utilise echo', 'conv-1', CONFIG));

    expect(h.executeTool).toHaveBeenCalledWith('echo', {});
    expect(steps.at(-1)).toEqual({ type: 'done', content: 'ok' });
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

describe('parseToolArgs', () => {
  it('garde un objet tel quel, parse une chaîne JSON objet', () => {
    expect(parseToolArgs({ a: 1 })).toEqual({ a: 1 });
    expect(parseToolArgs('{"a":1}')).toEqual({ a: 1 });
  });

  it('rend {} pour un JSON invalide ou qui n’est pas un objet', () => {
    expect(parseToolArgs('{tronqué')).toEqual({});
    expect(parseToolArgs('[1,2]')).toEqual({});
    expect(parseToolArgs('null')).toEqual({});
  });
});

// ─── Latence : cache de prompt, travail de fond, préchauffage ──────────────

describe('AgentOrchestrator — latence', () => {
  it("le prompt système est IDENTIQUE d'un tour à l'autre (Ollama le garde en cache)", async () => {
    const h = makeHarness({
      turns: [[token('a')], [token('b')]],
      warmFacts: ['- préfère les sources françaises'],
      relevantMemories: ['souvenir du tour'],
    });
    await collect(h.orchestrator.process('première', 'conv-1', CONFIG));
    await new Promise(r => setTimeout(r, 1100)); // l'horloge a changé de seconde
    await collect(h.orchestrator.process('seconde', 'conv-1', CONFIG));

    const [first, second] = h.llmCalls;
    expect(first?.system).toBe(second?.system);
    // Mémoire long terme : dans le système. Souvenirs du tour : dans le dernier message.
    expect(first?.system).toContain('préfère les sources françaises');
    expect(first?.system).not.toContain('souvenir du tour');
    expect(first?.messages.at(-1)?.content).toContain('souvenir du tour');
  });

  it("l'extraction de faits est DIFFÉRÉE au premier silence, pas lancée après la réponse", async () => {
    const scheduler = new LlmScheduler({ quietMs: 60_000 });
    const h = makeHarness({ turns: [[token('réponse')]], scheduler, withFactExtractor: true });
    await collect(h.orchestrator.process('salut', 'conv-1', CONFIG));

    expect(h.extractAndStore).not.toHaveBeenCalled();
    expect(scheduler.pendingCount).toBe(1);
    scheduler.dispose();
  });

  it('préchauffage : lit le prompt système exact des runs et le noyau d’outils, sans générer', async () => {
    const h = makeHarness({ turns: [[], [token('ok')]], warmFacts: ['- fait'] });
    await h.orchestrator.warmupForUser('qwen3:14b');
    await collect(h.orchestrator.process('salut', 'conv-1', CONFIG));

    const [warm, run] = h.llmCalls;
    expect(warm?.maxTokens).toBe(1);
    expect(warm?.system).toBe(run?.system);
    expect(warm?.tools).toEqual(run?.tools);
  });

  it('préchauffage ignoré si le modèle vient de servir (déjà chaud, cache meilleur)', async () => {
    const h = makeHarness({ turns: [[token('ok')]] });
    await collect(h.orchestrator.process('salut', 'conv-1', CONFIG));
    await h.orchestrator.warmupForUser('qwen3:14b');
    expect(h.llmCalls).toHaveLength(1);
  });

  it("la liste d'outils reste IDENTIQUE au tour suivant quand la question n'en demande pas de nouveau", async () => {
    const core = [
      'search_dailies',
      'read_webpage',
      'fetch_tech_news',
      'search_memory',
      'read_clipboard',
      'list_scheduled_tasks',
      'schedule_task',
    ];
    const toolDefs = [
      ...core.map(name => ({ name, description: 'outil de base' })),
      { name: 'post_tech_news_discord', description: 'Publie sur Discord' },
      { name: 'git_log', description: 'Historique git' },
      { name: 'docker_ps', description: 'Conteneurs docker' },
      { name: 'kill_process', description: 'Tue un processus' },
    ];
    const h = makeHarness({ turns: [[token('a')], [token('b')]], toolDefs });
    await collect(h.orchestrator.process('publie ça sur discord', 'conv-1', CONFIG));
    await collect(h.orchestrator.process('et ensuite ?', 'conv-1', CONFIG));

    const names = (call: (typeof h.llmCalls)[number] | undefined) =>
      (call?.tools as Array<{ function: { name: string } }> | undefined)?.map(t => t.function.name);
    expect(names(h.llmCalls[0])).toContain('post_tech_news_discord');
    expect(names(h.llmCalls[1])).toEqual(names(h.llmCalls[0]));
  });
});

describe('AgentOrchestrator — préchauffage de la conversation ouverte', () => {
  it("relit l'historique de la conversation : la question suivante n'a plus que son message à lire", async () => {
    const priorMessages: OllamaMessage[] = [
      { role: 'user', content: 'Quelle est la capitale du Japon ?' },
      { role: 'assistant', content: 'Tokyo.' },
    ];
    const h = makeHarness({ turns: [[], [token('Ottawa.')]], priorMessages });
    await h.orchestrator.warmupForUser('qwen3:14b', 'conv-1');
    await collect(h.orchestrator.process('Et celle du Canada ?', 'conv-1', CONFIG));

    const [warm, run] = h.llmCalls;
    // Même début : système, outils, historique — seul le dernier message diffère.
    expect(warm?.system).toBe(run?.system);
    expect(warm?.tools).toEqual(run?.tools);
    expect(warm?.messages.slice(0, -1)).toEqual(run?.messages.slice(0, -1));
    expect(warm?.messages.slice(0, -1)).toEqual(priorMessages);
  });
});
