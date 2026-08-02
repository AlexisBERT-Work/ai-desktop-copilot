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

export class AgentOrchestrator {
  private readonly defaultMaxIterations = 10;

  constructor(
    private llm: OllamaClient,
    private tools: ToolRegistry,
    private permissions: PermissionEngine,
    private context: ContextManager,
    private audit: AuditLogger,
    /**
     * Modèle léger optionnel. S'il est fourni, l'orchestrateur peut rétrograder
     * vers ce modèle pour les tâches triviales (gain ressources). Sinon, le
     * modèle de la requête est toujours utilisé tel quel.
     */
    private smallModel?: string,
    /** Planificateur optionnel (utilisé seulement si config.usePlanning). */
    private planner?: Planner,
    /** Suivi d'activité optionnel (alimente la détection de spirale). */
    private activity?: ActivityTracker,
    /**
     * Mode passif optionnel : garde le modèle chaud pendant un run, puis le
     * décharge de la VRAM après une fenêtre d'inactivité (libère le GPU).
     */
    private idleUnloader?: IdleUnloader,
    /**
     * Extracteur de faits warm optionnel : après une réponse réussie, mine la
     * conversation (en tâche de fond) pour mémoriser les faits durables sur
     * l'utilisateur. Voir CATDESK-CONCEPTS-AVANCES §3.
     */
    private factExtractor?: FactExtractor,
    /**
     * Compaction optionnelle : après un tour, replie l'historique ancien en un
     * résumé glissant quand il devient long (CATDESK-CONCEPTS-AVANCES §2A).
     */
    private compactor?: Compactor,
    /**
     * Playbook optionnel : consulte avant la tâche l'approche qui a marché pour
     * ce type de tâche, et enregistre l'issue après (CATDESK-CONCEPTS-AVANCES §8).
     */
    private playbook?: PlaybookStore,
    /**
     * Cache sémantique optionnel : pour une requête autonome (sans historique),
     * sert une réponse déjà calculée pour une question équivalente sans appeler
     * le LLM (CATDESK-CONCEPTS-AVANCES §E). Désactivable via CATDESK_SEMANTIC_CACHE=0.
     */
    private cache?: SemanticCache,
  ) {}

  /** Décide du modèle effectif selon le mode (auto/light/code). */
  private pickModel(input: string, usesTools: boolean, config: AgentConfig): string {
    const light = config.lightModel ?? this.smallModel;
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
    this.permissions.updateConfig(config);
  }

  async *process(
    input: string,
    conversationId: string,
    config: AgentConfig,
    signal?: AbortSignal,
  ): AsyncGenerator<AgentStep> {
    const runId = crypto.randomUUID();
    log.info('Run started', { runId, conversationId, model: config.model });
    this.audit.startRun(runId, conversationId, input);

    // Build context (messages + memories + screen context)
    const ctx = await this.context.buildContext(conversationId, input);

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
    const enabledTools = this.tools.getEnabled(config.enabledTools);
    const availableTools = selectTools(enabledTools, input, TOOL_LIMIT);

    // Playbook (§8): classify the task and pull the approach that worked before.
    const taskType = classifyTask(input);
    const best = this.playbook?.bestApproach(taskType);
    const playbookHint = best
      ? `Type de tâche : « ${taskType} ». Approche qui a réussi par le passé : ${best.approach} ` +
        `(${Math.round(best.successRate * 100)}% de succès sur ${best.attempts} essais). Inspire-t'en si pertinent.`
      : undefined;
    // Tools actually executed this run → the "approach" we record at the end.
    const usedTools: string[] = [];

    const messages = [...ctx.messages];
    // Add user message
    messages.push({ role: 'user', content: input });

    // Choix du modèle (auto/light/code) une fois par run.
    const model = this.pickModel(input, availableTools.length > 0, config);

    // Mode passif : garder le modèle chaud pendant ce run. Le `finally` plus bas
    // réarme le minuteur d'inactivité quel que soit le chemin de sortie
    // (succès, erreur, interruption, abandon du consommateur).
    this.idleUnloader?.begin(model);
    try {
      // Phase de planification optionnelle (opt-in). Le plan est généré une fois
      // puis injecté comme guidage dans le system prompt.
      let plan: string[] = [];
      if (config.usePlanning && this.planner) {
        plan = await this.planner.plan(input, model);
        if (plan.length > 0) {
          log.info('Planning enabled', { runId, steps: plan.length });
          yield { type: 'plan', steps: plan };
        }
      }

      const systemPrompt = buildSystemPrompt(
        { ...ctx, ...(playbookHint ? { playbookHint } : {}) },
        plan,
      );

      const maxIterations = config.maxIterations ?? this.defaultMaxIterations;
      let iterations = 0;

      while (iterations < maxIterations) {
        // Interruption (bouton Stop) : on s'arrête net entre deux étapes.
        if (signal?.aborted) {
          log.info('Run interrupted', { runId, iteration: iterations });
          this.audit.completeRun(runId, 'interrupted');
          return;
        }
        iterations++;
        log.debug('Iteration', { runId, iteration: iterations });

        // ─── LLM Call ───────────────────────────────────────────
        const stream = this.llm.streamChat({
          model,
          messages,
          tools: availableTools.map(t => t.toOllamaSchema()),
          system: systemPrompt,
          temperature: config.temperature ?? 0.7,
          numCtx: NUM_CTX,
          maxTokens: MAX_TOKENS,
          // think:false — coupe le raisonnement des modèles qwen3 sur le chat
          // interactif. Sans ça, qwen3:14b (choisi par le launcher sur ≥ 9 GiB
          // de VRAM) génère un long bloc <think> caché AVANT chaque réponse :
          // gros coût de latence au premier token pour un bot recentré sur la
          // recherche/les articles, où le raisonnement explicite n'apporte rien.
          // Les digests coupent déjà le raisonnement (digestLlm.ts) ; le chat
          // avait été oublié. Ollama tolère le champ sur les modèles sans
          // raisonnement (ex. qwen2.5:7b), donc l'envoyer inconditionnellement
          // est sûr. Le raisonnement multi-étapes reste disponible via le
          // Planner opt-in (config.usePlanning).
          think: false,
          ...(signal ? { signal } : {}),
        });

        const turn = yield* this.streamAssistantTurn(stream);
        if (turn.errored) {
          this.audit.completeRun(runId, 'error');
          return;
        }
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
            }),
          );
        }
      }

      // Max iterations reached
      log.warn('Max iterations reached', { runId, maxIterations });
      this.audit.completeRun(runId, 'max_iterations');
      // Playbook (§8): this approach did not converge for this task type.
      this.playbook?.record(taskType, approachSignature(usedTools), false);
      yield {
        type: 'error',
        content: `Limite d'itérations atteinte (${maxIterations}). Réponse partielle disponible.`,
        code: 'MAX_ITERATIONS',
      };
    } finally {
      // Run terminé (ou interrompu) : (re)programme le déchargement du modèle.
      this.idleUnloader?.end();
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
    if (!this.cache) return null;
    const hit = await this.cache.lookup(input).catch(() => null);
    if (!hit) return null;
    log.info('Semantic cache hit — skipping LLM', {
      runId,
      similarity: Number(hit.similarity.toFixed(3)),
      exact: hit.exact,
    });
    this.audit.completeRun(runId, 'success', hit.answer);
    // Record the turn so follow-ups keep conversational memory.
    this.context.recordTurn(conversationId, model, input, hit.answer);
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
          args:
            typeof chunk.toolCall.function.arguments === 'string'
              ? JSON.parse(chunk.toolCall.function.arguments)
              : chunk.toolCall.function.arguments,
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
    opts: { runId: string; conversationId: string; activeWindow?: string; usedTools: string[] },
  ): AsyncGenerator<AgentStep, OllamaMessage> {
    yield { type: 'tool_start', toolName: toolCall.name, args: toolCall.args };

    // Permission gate
    const permission = await this.permissions.check({
      tool: toolCall.name,
      args: toolCall.args,
      context: {
        conversationId: opts.conversationId,
        ...(opts.activeWindow !== undefined ? { activeWindow: opts.activeWindow } : {}),
      },
    });

    if (!permission.granted) {
      yield {
        type: 'tool_blocked',
        toolName: toolCall.name,
        reason: permission.reason ?? 'denied',
      };
      return {
        role: 'tool',
        content: JSON.stringify({ error: `Permission denied: ${permission.reason}` }),
        tool_call_id: toolCall.id,
      };
    }

    // Execute tool
    try {
      opts.usedTools.push(toolCall.name); // record the approach for the playbook
      const result = await this.tools.execute(toolCall.name, toolCall.args);
      this.audit.logToolCall(opts.runId, toolCall.name, toolCall.args, result);
      this.activity?.recordToolCall(toolCall.name, toolCall.args, result.success);

      yield { type: 'tool_result', toolName: toolCall.name, result };
      // Post-execution safety scan (§7): a tool output becomes LLM context,
      // so redact secrets and neutralize injection BEFORE it gets there.
      // Applied to BOTH success and error branches — an error message can
      // echo file contents, injected text, or secrets just as easily.
      const rawContent = JSON.stringify(result.success ? result.data : { error: result.error });
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
      this.activity?.recordToolCall(toolCall.name, toolCall.args, false);
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
    const { runId, conversationId, model, input, answer } = opts;
    this.audit.completeRun(runId, 'success', answer);
    // Persist the exchange so the next turn has conversational memory.
    this.context.recordTurn(conversationId, model, input, answer);
    // Index it for cross-conversation semantic recall (fire-and-forget).
    void this.context
      .rememberExchange(conversationId, input, answer)
      .catch(err => log.debug('rememberExchange failed', { error: String(err) }));
    // Semantic cache (§E): only cache tool-free answers to a standalone
    // query — a tool result reflects mutable world state, and a follow-up
    // answer depends on context that won't be present next time.
    if (this.cache && opts.standalone && opts.usedTools.length === 0) {
      void this.cache
        .put(input, answer)
        .catch(err => log.debug('Semantic cache put failed', { error: String(err) }));
    }
    // Playbook (§8): this approach worked for this task type.
    this.playbook?.record(opts.taskType, approachSignature(opts.usedTools), true);
    // Compact older history into a rolling summary if it's grown long.
    if (this.compactor) {
      void this.compactor
        .maybeCompact(conversationId)
        .catch(err => log.debug('Compaction failed', { error: String(err) }));
    }
    // Mine durable facts from this exchange in the background (warm memory).
    // Fire-and-forget: never block or fail the user's response.
    if (this.factExtractor) {
      const transcript = [...opts.messages, { role: 'assistant' as const, content: answer }];
      void this.factExtractor
        .extractAndStore(transcript, conversationId)
        .catch(err => log.debug('Fact extraction failed', { error: String(err) }));
    }
  }
}
