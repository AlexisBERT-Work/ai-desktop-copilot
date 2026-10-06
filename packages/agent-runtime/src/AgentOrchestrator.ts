import type {
  AgentConfig,
  AgentStep,
  ToolCall,
  PermissionConfig,
  OllamaMessage,
  StreamChunk,
} from '@catdesk/shared-types';
import type { OllamaClient } from './llm/OllamaClient';
import type { ToolRegistry } from './ToolRegistry';
import type { PermissionEngine } from './permissions/PermissionEngine';
import type { ContextManager } from './ContextManager';
import type { AuditLogger } from './AuditLogger';
import { resolveModel } from './llm/ModelRouter';
import {
  recoverToolCalls,
  looksLikeToolCallStart,
  looksLikePreamble,
} from './llm/recoverToolCalls';
import { selectTools } from './llm/selectTools';
import type { Planner } from './llm/Planner';
import type { ActivityTracker } from './ActivityTracker';
import type { IdleUnloader } from './llm/IdleUnloader';
import type { FactExtractor } from './memory/FactExtractor';
import type { Compactor } from './memory/Compactor';
import type { SemanticCache } from './memory/SemanticCache';
import type { PlaybookStore } from './playbook/PlaybookStore';
import { approachSignature } from './playbook/PlaybookStore';
import { classifyTask, type TaskType } from './playbook/classifyTask';
import { sanitizeToolOutput } from './security/sanitizeToolOutput';
import { createLogger } from './logger';
import { CONFIG } from './config';
import { buildSystemPrompt } from './prompts/systemPrompt';

const log = createLogger('agent:orchestrator');

// Avec ~50 outils exposés, le prompt (schémas + system + historique) dépasse
// largement 4096 tokens. Sans une fenêtre assez grande, Ollama tronque le
// contexte : le modèle perd les définitions d'outils et le system prompt, puis
// déraille (réponses hors-sujet, en anglais, JSON recraché) et part en
// génération interminable. On élargit donc num_ctx et on borne num_predict.
const NUM_CTX = CONFIG.numCtx;
const MAX_TOKENS = CONFIG.maxTokens;
// Max number of tools sent to the model per call. ~50 tools ≈ several thousand
// prompt tokens → slow prompt eval on local models. We send only the relevant
// subset (see selectTools). Set to 0 to disable the filter and send all.
const TOOL_LIMIT = CONFIG.toolLimit;
const DEFAULT_MAX_ITERATIONS = 10;

/**
 * Dépendances de l'orchestrateur. Les cinq premières sont requises ; les
 * suivantes activent chacune une technique optionnelle (voir
 * CATDESK-CONCEPTS-AVANCES) et peuvent manquer sans rien casser.
 */
export interface OrchestratorDeps {
  llm: OllamaClient;
  tools: ToolRegistry;
  permissions: PermissionEngine;
  context: ContextManager;
  audit: AuditLogger;
  /**
   * Modèle léger : s'il est fourni, l'orchestrateur peut rétrograder vers lui
   * pour les tâches triviales. Sinon, le modèle de la requête est utilisé tel quel.
   */
  smallModel?: string | undefined;
  /** Planificateur (utilisé seulement si `config.usePlanning`). */
  planner?: Planner | undefined;
  /** Suivi d'activité (alimente la détection de spirale). */
  activity?: ActivityTracker | undefined;
  /** Mode passif : garde le modèle chaud pendant un run, le décharge après. */
  idleUnloader?: IdleUnloader | undefined;
  /** Extraction de faits durables après une réponse (mémoire warm, §3). */
  factExtractor?: FactExtractor | undefined;
  /** Compaction de l'historique ancien en résumé glissant (§2A). */
  compactor?: Compactor | undefined;
  /** Mémoire de stratégie : approche gagnante par type de tâche (§8). */
  playbook?: PlaybookStore | undefined;
  /** Cache sémantique des réponses aux questions autonomes (§E). */
  cache?: SemanticCache | undefined;
}

/**
 * Arguments d'un tool call tels qu'émis par le modèle : objet, ou chaîne JSON
 * — éventuellement invalide (un modèle local tronque volontiers son JSON). Un
 * argument illisible devient `{}` : la validation zod de l'outil renverra au
 * LLM une erreur actionnable, au lieu de faire tomber tout le run.
 */
export function parseToolArgs(raw: string | Record<string, unknown>): Record<string, unknown> {
  if (typeof raw !== 'string') return raw;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export class AgentOrchestrator {
  constructor(private readonly deps: OrchestratorDeps) {}

  /** Décide du modèle effectif selon le mode (auto/light/code). */
  private pickModel(input: string, usesTools: boolean, config: AgentConfig): string {
    const light = config.lightModel ?? this.deps.smallModel;
    const decision = resolveModel({
      mode: config.modelMode ?? 'auto',
      requested: config.model,
      ...(light ? { light } : {}),
      ...(config.codeModel ? { code: config.codeModel } : {}),
      input,
      usesTools,
    });
    if (decision.model !== config.model) {
      log.info('Model selection', {
        mode: config.modelMode ?? 'auto',
        model: decision.model,
        reason: decision.reason,
      });
    }
    return decision.model;
  }

  updatePermissions(config: Partial<PermissionConfig>): void {
    this.deps.permissions.updateConfig(config);
  }

  /**
   * Réponse de l'utilisateur à une demande de confirmation (dialogue de
   * permission). Débloque le `requestUserConfirmation()` en attente — sans
   * cela, tout outil à risque `high` reste bloqué jusqu'à son délai.
   */
  resolvePermission(requestId: string, granted: boolean, remember?: boolean): void {
    this.deps.permissions.resolvePermissionRequest(requestId, granted, remember);
  }

  /**
   * Exécute un run. Ne lève jamais vers l'appelant : une erreur inattendue
   * devient une étape `error` (code INTERNAL) et le run est audité comme tel —
   * sinon l'UI, qui n'attend que des étapes, resterait en « réfléchit… ».
   */
  async *process(
    input: string,
    conversationId: string,
    config: AgentConfig,
    signal?: AbortSignal,
  ): AsyncGenerator<AgentStep> {
    const runId = crypto.randomUUID();
    log.info('Run started', { runId, conversationId, model: config.model });
    this.deps.audit.startRun(runId, conversationId, input);
    try {
      yield* this.run(runId, input, conversationId, config, signal);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error('Run failed', { runId, error: message });
      this.deps.audit.completeRun(runId, 'error');
      yield { type: 'error', content: `Erreur interne de l'agent : ${message}`, code: 'INTERNAL' };
    }
  }

  private async *run(
    runId: string,
    input: string,
    conversationId: string,
    config: AgentConfig,
    signal: AbortSignal | undefined,
  ): AsyncGenerator<AgentStep> {
    const { llm, tools, context, audit, playbook, idleUnloader, planner } = this.deps;

    // Build context (messages + memories + screen context)
    const ctx = await context.buildContext(conversationId, input);

    // A query is "standalone" when the conversation has no prior turns: its
    // answer can't depend on earlier context, so it's safe to serve/store in the
    // semantic cache (§E). Context-dependent follow-ups bypass the cache.
    const standalone = ctx.messages.length === 0;

    // ─── Semantic cache consult ──────────────────────────────
    // On a hit we skip the LLM entirely (big latency win on slow first-token
    // local hardware). Only for standalone queries — see `standalone` above.
    if (standalone) {
      const cached = await this.tryServeFromCache(input, conversationId, config.model, runId);
      if (cached !== null) {
        yield { type: 'token', content: cached };
        yield { type: 'done', content: cached };
        return;
      }
    }

    // Only expose a small, query-relevant subset to keep the prompt small and
    // fast (the full ~50-tool schema set dominates local-model latency).
    const enabledTools = tools.getEnabled(config.enabledTools);
    const availableTools = selectTools(enabledTools, input, TOOL_LIMIT);

    // Playbook (§8): classify the task and pull the approach that worked before.
    const taskType = classifyTask(input);
    const best = playbook?.bestApproach(taskType);
    const playbookHint = best
      ? `Type de tâche : « ${taskType} ». Approche qui a réussi par le passé : ${best.approach} ` +
        `(${Math.round(best.successRate * 100)}% de succès sur ${best.attempts} essais). Inspire-t'en si pertinent.`
      : undefined;
    // Tools actually executed this run → the "approach" we record at the end.
    const usedTools: string[] = [];

    const messages = [...ctx.messages, { role: 'user' as const, content: input }];

    // Choix du modèle (auto/light/code) une fois par run.
    const model = this.pickModel(input, availableTools.length > 0, config);

    const interrupted = (iteration: number): boolean => {
      if (!signal?.aborted) return false;
      log.info('Run interrupted', { runId, iteration });
      audit.completeRun(runId, 'interrupted');
      return true;
    };

    // Mode passif : garder le modèle chaud pendant ce run. Le `finally` plus bas
    // réarme le minuteur d'inactivité quel que soit le chemin de sortie
    // (succès, erreur, interruption, abandon du consommateur).
    idleUnloader?.begin(model);
    try {
      // Phase de planification optionnelle (opt-in). Le plan est généré une fois
      // puis injecté comme guidage dans le system prompt.
      let plan: string[] = [];
      if (config.usePlanning && planner) {
        plan = await planner.plan(input, model, signal);
        if (plan.length > 0) {
          log.info('Planning enabled', { runId, steps: plan.length });
          yield { type: 'plan', steps: plan };
        }
      }

      const systemPrompt = buildSystemPrompt(
        { ...ctx, ...(playbookHint ? { playbookHint } : {}) },
        plan,
      );

      const maxIterations = config.maxIterations ?? DEFAULT_MAX_ITERATIONS;
      for (let iteration = 1; iteration <= maxIterations; iteration++) {
        // Interruption (bouton Stop) : on s'arrête net entre deux étapes.
        if (interrupted(iteration)) return;
        log.debug('Iteration', { runId, iteration });

        // ─── LLM Call ───────────────────────────────────────────
        const stream = llm.streamChat({
          model,
          messages,
          tools: availableTools.map(t => t.toOllamaSchema()),
          system: systemPrompt,
          temperature: config.temperature ?? 0.7,
          numCtx: NUM_CTX,
          maxTokens: MAX_TOKENS,
          // think:false — coupe le raisonnement caché des modèles qwen3 sur le
          // chat interactif : sans ça, un long bloc <think> précède chaque
          // réponse (gros coût au premier token, rien gagné pour un bot de
          // recherche). Ollama tolère le champ sur les modèles sans
          // raisonnement. Le raisonnement multi-étapes reste disponible via le
          // Planner opt-in (config.usePlanning).
          think: false,
          ...(signal ? { signal } : {}),
        });

        const turn = yield* this.streamAssistantTurn(stream);
        if (turn.errored) {
          audit.completeRun(runId, 'error');
          return;
        }
        // Un Stop pendant le flux le termine sans erreur : la réponse est
        // TRONQUÉE. Elle ne doit ni être finalisée, ni surtout entrer dans le
        // cache sémantique, qui la resservirait plus tard comme complète.
        if (interrupted(iteration)) return;

        let fullResponse = turn.text;
        const toolCalls = turn.toolCalls;

        // ─── Recover text-emitted tool calls ──────────────────
        // Small local models sometimes print the tool call as JSON / inside
        // <tool_call> tags instead of using Ollama's native tool-calling. Run
        // those for real so the user gets an answer, not a JSON blob.
        if (toolCalls.length === 0) {
          const recovered = recoverToolCalls(
            fullResponse,
            new Set(availableTools.map(t => t.name)),
          );
          if (recovered.calls.length > 0) {
            log.info('Recovered text-emitted tool calls', { runId, count: recovered.calls.length });
            toolCalls.push(...recovered.calls);
            fullResponse = recovered.cleanedText;
          }
        }

        // ─── No tool calls → final answer ─────────────────────
        if (toolCalls.length === 0) {
          // False alarm: we withheld content that turned out to be a genuine
          // answer, not a tool call. Surface it now so the UI isn't left blank.
          if (!turn.streamedToUser && fullResponse.trim().length > 0) {
            yield { type: 'token', content: fullResponse };
          }
          this.finalizeAnswer({
            runId,
            conversationId,
            model,
            input,
            answer: fullResponse,
            messages,
            standalone,
            taskType,
            usedTools,
          });
          yield { type: 'done', content: fullResponse };
          return;
        }

        // ─── Process tool calls ────────────────────────────────
        messages.push({
          role: 'assistant',
          content: fullResponse,
          tool_calls: toolCalls.map(tc => ({
            id: tc.id,
            type: 'function' as const,
            // Pass arguments as an OBJECT — Ollama rejects a JSON string here
            // (400) when this assistant message is replayed next iteration.
            function: { name: tc.name, arguments: tc.args },
          })),
        });

        for (const toolCall of toolCalls) {
          messages.push(
            yield* this.runToolCall(toolCall, {
              runId,
              conversationId,
              ...(ctx.activeWindow !== undefined ? { activeWindow: ctx.activeWindow } : {}),
              usedTools,
              signal,
            }),
          );
        }
      }

      // Max iterations reached
      log.warn('Max iterations reached', { runId, maxIterations });
      audit.completeRun(runId, 'max_iterations');
      // Playbook (§8): this approach did not converge for this task type.
      playbook?.record(taskType, approachSignature(usedTools), false);
      yield {
        type: 'error',
        content: `Limite d'itérations atteinte (${maxIterations}). Réponse partielle disponible.`,
        code: 'MAX_ITERATIONS',
      };
    } finally {
      // Run terminé (ou interrompu) : (re)programme le déchargement du modèle.
      idleUnloader?.end();
    }
  }

  /**
   * Cache sémantique (§E) : si une question équivalente a déjà été résolue,
   * renvoie la réponse mémorisée (et enregistre le tour) sans appeler le LLM.
   * Retourne null en l'absence de cache ou de hit.
   */
  private async tryServeFromCache(
    input: string,
    conversationId: string,
    model: string,
    runId: string,
  ): Promise<string | null> {
    const { cache, audit, context } = this.deps;
    if (!cache) return null;
    const hit = await cache.lookup(input).catch(() => null);
    if (!hit) return null;
    log.info('Semantic cache hit — skipping LLM', {
      runId,
      similarity: Number(hit.similarity.toFixed(3)),
      exact: hit.exact,
    });
    audit.completeRun(runId, 'success', hit.answer);
    // Record the turn so follow-ups keep conversational memory.
    context.recordTurn(conversationId, model, input, hit.answer);
    return hit.answer;
  }

  /**
   * Consomme un stream LLM : relaie les tokens à l'UI (avec rétention si la
   * réponse s'ouvre comme un tool call émis en texte ou un préambule), et
   * collecte les tool calls natifs de fin de stream. Sur un chunk d'erreur,
   * yield l'étape d'erreur et rend `errored: true` (l'appelant clôt le run).
   */
  private async *streamAssistantTurn(
    stream: AsyncIterable<StreamChunk>,
  ): AsyncGenerator<
    AgentStep,
    { text: string; streamedToUser: boolean; toolCalls: ToolCall[]; errored: boolean }
  > {
    let text = '';
    let streamedToUser = false;
    let withholding = false;
    const toolCalls: ToolCall[] = [];

    for await (const chunk of stream) {
      if (chunk.type === 'token') {
        text += chunk.content;
        // Withhold from the live UI if the response opens like (a) a tool call
        // emitted as text (raw JSON / <tool_call> tags) — we may recover and
        // execute it below instead of flashing a JSON blob — or (b) a "je vais
        // faire X, attends…" preamble that precedes a tool call. In both cases
        // we decide at end-of-turn: drop it if a tool call follows, flush it as
        // the genuine answer otherwise.
        if (
          !streamedToUser &&
          !withholding &&
          (looksLikeToolCallStart(text) || looksLikePreamble(text))
        ) {
          withholding = true;
        }
        if (!withholding) {
          streamedToUser = true;
          yield { type: 'token', content: chunk.content };
        }
      } else if (chunk.type === 'tool_call') {
        // Tool calls come at end of stream
        toolCalls.push({
          id: chunk.toolCall.id,
          name: chunk.toolCall.function.name,
          args: parseToolArgs(chunk.toolCall.function.arguments),
        });
      } else if (chunk.type === 'error') {
        yield { type: 'error', content: chunk.error };
        return { text, streamedToUser, toolCalls, errored: true };
      }
    }
    return { text, streamedToUser, toolCalls, errored: false };
  }

  /**
   * Exécute un tool call : porte de permission, exécution auditée, puis scan
   * de sécurité de la sortie. Yield les étapes UI (tool_start puis
   * blocked/result/error) et rend le message `role: 'tool'` à rejouer au LLM.
   */
  private async *runToolCall(
    toolCall: ToolCall,
    opts: {
      runId: string;
      conversationId: string;
      activeWindow?: string;
      usedTools: string[];
      signal: AbortSignal | undefined;
    },
  ): AsyncGenerator<AgentStep, OllamaMessage> {
    const { tools, permissions, audit, activity } = this.deps;
    yield { type: 'tool_start', toolName: toolCall.name, args: toolCall.args };

    try {
      // Permission gate. Les chemins à vérifier sont ceux que l'OUTIL déclare
      // (pathArgs), pas une liste de clés devinée ici.
      const permission = await permissions.check(
        {
          tool: toolCall.name,
          args: toolCall.args,
          paths: tools.filesystemTargets(toolCall.name, toolCall.args),
          context: {
            conversationId: opts.conversationId,
            ...(opts.activeWindow !== undefined ? { activeWindow: opts.activeWindow } : {}),
          },
        },
        opts.signal,
      );

      if (!permission.granted) {
        const reason = permission.reason ?? 'refusé';
        yield { type: 'tool_blocked', toolName: toolCall.name, reason };
        return {
          role: 'tool',
          content: JSON.stringify({ error: `Permission denied: ${reason}` }),
          tool_call_id: toolCall.id,
        };
      }

      opts.usedTools.push(toolCall.name); // record the approach for the playbook
      const result = await tools.execute(toolCall.name, toolCall.args);
      audit.logToolCall(opts.runId, toolCall.name, toolCall.args, result);
      activity?.recordToolCall(toolCall.name, toolCall.args, result.success);

      yield { type: 'tool_result', toolName: toolCall.name, result };
      // Post-execution safety scan (§7): a tool output becomes LLM context,
      // so redact secrets and neutralize injection BEFORE it gets there.
      // Applied to BOTH success and error branches — an error message can
      // echo file contents, injected text, or secrets just as easily.
      // `?? 'null'` : JSON.stringify(undefined) vaut undefined, pas une chaîne.
      const rawContent =
        JSON.stringify(result.success ? result.data : { error: result.error }) ?? 'null';
      const scan = sanitizeToolOutput(rawContent);
      if (scan.redactions.length > 0 || scan.injectionFlags.length > 0) {
        log.warn('Tool output sanitized', {
          runId: opts.runId,
          tool: toolCall.name,
          redactions: scan.redactions,
          injection: scan.injectionFlags,
        });
      }
      return { role: 'tool', content: scan.text, tool_call_id: toolCall.id };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.error('Tool execution failed', { tool: toolCall.name, error });
      activity?.recordToolCall(toolCall.name, toolCall.args, false);
      yield { type: 'tool_error', toolName: toolCall.name, error };
      return {
        role: 'tool',
        content: JSON.stringify({ error }),
        tool_call_id: toolCall.id,
      };
    }
  }

  /**
   * Effets de bord d'une réponse finale réussie (sans tool call restant) :
   * audit, persistance du tour, indexation sémantique, cache, playbook,
   * compaction et extraction de faits — tous best-effort et non bloquants.
   */
  private finalizeAnswer(opts: {
    runId: string;
    conversationId: string;
    model: string;
    input: string;
    answer: string;
    messages: OllamaMessage[];
    standalone: boolean;
    taskType: TaskType;
    usedTools: string[];
  }): void {
    const { audit, context, cache, playbook, compactor, factExtractor } = this.deps;
    const { runId, conversationId, model, input, answer } = opts;
    audit.completeRun(runId, 'success', answer);
    // Persist the exchange so the next turn has conversational memory.
    context.recordTurn(conversationId, model, input, answer);
    // Index it for cross-conversation semantic recall (fire-and-forget).
    void context
      .rememberExchange(conversationId, input, answer)
      .catch(err => log.debug('rememberExchange failed', { error: String(err) }));
    // Semantic cache (§E): only cache tool-free answers to a standalone
    // query — a tool result reflects mutable world state, and a follow-up
    // answer depends on context that won't be present next time.
    if (cache && opts.standalone && opts.usedTools.length === 0) {
      void cache
        .put(input, answer)
        .catch(err => log.debug('Semantic cache put failed', { error: String(err) }));
    }
    // Playbook (§8): this approach worked for this task type.
    playbook?.record(opts.taskType, approachSignature(opts.usedTools), true);
    // Compact older history into a rolling summary if it's grown long.
    if (compactor) {
      void compactor
        .maybeCompact(conversationId)
        .catch(err => log.debug('Compaction failed', { error: String(err) }));
    }
    // Mine durable facts from this exchange in the background (warm memory).
    // Fire-and-forget: never block or fail the user's response.
    if (factExtractor) {
      const transcript = [...opts.messages, { role: 'assistant' as const, content: answer }];
      void factExtractor
        .extractAndStore(transcript, conversationId)
        .catch(err => log.debug('Fact extraction failed', { error: String(err) }));
    }
  }
}
