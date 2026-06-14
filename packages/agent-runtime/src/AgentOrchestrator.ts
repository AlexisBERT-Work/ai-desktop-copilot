import type { AgentConfig, AgentStep, ToolCall, PermissionConfig } from '@catdesk/shared-types';
import type { OllamaClient } from './llm/OllamaClient';
import type { ToolRegistry } from './ToolRegistry';
import type { PermissionEngine } from './permissions/PermissionEngine';
import type { ContextManager } from './ContextManager';
import type { AuditLogger } from './AuditLogger';
import { resolveModel } from './llm/ModelRouter';
import { recoverToolCalls, looksLikeToolCallStart } from './llm/recoverToolCalls';
import { selectTools } from './llm/selectTools';
import type { Planner } from './llm/Planner';
import type { ActivityTracker } from './ActivityTracker';
import type { IdleUnloader } from './llm/IdleUnloader';
import type { FactExtractor } from './memory/FactExtractor';
import type { Compactor } from './memory/Compactor';
import type { PlaybookStore } from './playbook/PlaybookStore';
import { approachSignature } from './playbook/PlaybookStore';
import { classifyTask } from './playbook/classifyTask';
import { sanitizeToolOutput } from './security/sanitizeToolOutput';
import { createLogger } from './logger';

const log = createLogger('agent:orchestrator');

// Avec ~50 outils exposés, le prompt (schémas + system + historique) dépasse
// largement 4096 tokens. Sans une fenêtre assez grande, Ollama tronque le
// contexte : le modèle perd les définitions d'outils et le system prompt, puis
// déraille (réponses hors-sujet, en anglais, JSON recraché) et part en
// génération interminable. On élargit donc num_ctx et on borne num_predict.
const NUM_CTX = Number(process.env['CATDESK_NUM_CTX'] ?? 8192);
const MAX_TOKENS = Number(process.env['CATDESK_MAX_TOKENS'] ?? 1024);
// Max number of tools sent to the model per call. ~50 tools ≈ several thousand
// prompt tokens → slow prompt eval on local models. We send only the relevant
// subset (see selectTools). Set to 0 to disable the filter and send all.
const TOOL_LIMIT = Number(process.env['CATDESK_TOOL_LIMIT'] ?? 14);

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
      log.info('Model selection', { mode: config.modelMode ?? 'auto', model: decision.model, reason: decision.reason });
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
    // Only expose a small, query-relevant subset to keep the prompt small and
    // fast (the full ~50-tool schema set dominates local-model latency).
    const enabledTools = this.tools.getEnabled(config.enabledTools);
    const availableTools = selectTools(enabledTools, input, TOOL_LIMIT);

    // Playbook (§8): classify the task and pull the approach that worked before.
    const taskType = classifyTask(input);
    const best = this.playbook?.bestApproach(taskType);
    const playbookHint = best
      ? `Type de tâche : « ${taskType} ». Approche qui a réussi par le passé : ${best.approach} `
        + `(${Math.round(best.successRate * 100)}% de succès sur ${best.attempts} essais). Inspire-t'en si pertinent.`
      : undefined;
    // Tools actually executed this run → the "approach" we record at the end.
    const usedTools: string[] = [];

    let messages = [...ctx.messages];
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

    const systemPrompt = this.buildSystemPrompt({ ...ctx, ...(playbookHint ? { playbookHint } : {}) }, plan);

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
        ...(signal ? { signal } : {}),
      });

      let fullResponse = '';
      let streamedToUser = false;
      let withholding = false;
      const toolCalls: ToolCall[] = [];

      for await (const chunk of stream) {
        if (chunk.type === 'token') {
          fullResponse += chunk.content;
          // Withhold from the live UI if the response opens like a tool call
          // emitted as text (raw JSON / <tool_call> tags) — we may recover and
          // execute it below instead of flashing a JSON blob at the user.
          if (!streamedToUser && !withholding && looksLikeToolCallStart(fullResponse)) {
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
            args: typeof chunk.toolCall.function.arguments === 'string'
              ? JSON.parse(chunk.toolCall.function.arguments)
              : chunk.toolCall.function.arguments,
          });
        } else if (chunk.type === 'error') {
          yield { type: 'error', content: chunk.error };
          this.audit.completeRun(runId, 'error');
          return;
        }
      }

      // ─── Recover text-emitted tool calls ──────────────────
      // Small local models sometimes print the tool call as JSON / inside
      // <tool_call> tags instead of using Ollama's native tool-calling. Run
      // those for real so the user gets an answer, not a JSON blob.
      if (toolCalls.length === 0) {
        const recovered = recoverToolCalls(fullResponse, new Set(availableTools.map(t => t.name)));
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
        if (!streamedToUser && fullResponse.trim().length > 0) {
          yield { type: 'token', content: fullResponse };
        }
        this.audit.completeRun(runId, 'success', fullResponse);
        // Persist the exchange so the next turn has conversational memory.
        this.context.recordTurn(conversationId, model, input, fullResponse);
        // Index it for cross-conversation semantic recall (fire-and-forget).
        void this.context.rememberExchange(conversationId, input, fullResponse)
          .catch(err => log.debug('rememberExchange failed', { error: String(err) }));
        // Playbook (§8): this approach worked for this task type.
        this.playbook?.record(taskType, approachSignature(usedTools), true);
        // Compact older history into a rolling summary if it's grown long.
        if (this.compactor) {
          void this.compactor.maybeCompact(conversationId)
            .catch(err => log.debug('Compaction failed', { error: String(err) }));
        }
        // Mine durable facts from this exchange in the background (warm memory).
        // Fire-and-forget: never block or fail the user's response.
        if (this.factExtractor) {
          const transcript = [...messages, { role: 'assistant' as const, content: fullResponse }];
          void this.factExtractor
            .extractAndStore(transcript, conversationId)
            .catch(err => log.debug('Fact extraction failed', { error: String(err) }));
        }
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
        yield { type: 'tool_start', toolName: toolCall.name, args: toolCall.args };

        // Permission gate
        const permission = await this.permissions.check({
          tool: toolCall.name,
          args: toolCall.args,
          context: { conversationId, ...(ctx.activeWindow !== undefined ? { activeWindow: ctx.activeWindow } : {}) },
        });

        if (!permission.granted) {
          const errorMsg = `Permission denied: ${permission.reason}`;
          yield { type: 'tool_blocked', toolName: toolCall.name, reason: permission.reason ?? 'denied' };
          messages.push({ role: 'tool', content: JSON.stringify({ error: errorMsg }), tool_call_id: toolCall.id });
          continue;
        }

        // Execute tool
        try {
          usedTools.push(toolCall.name); // record the approach for the playbook
          const result = await this.tools.execute(toolCall.name, toolCall.args);
          this.audit.logToolCall(runId, toolCall.name, toolCall.args, result);
          this.activity?.recordToolCall(toolCall.name, toolCall.args, result.success);

          yield { type: 'tool_result', toolName: toolCall.name, result };
          // Post-execution safety scan (§7): a tool output becomes LLM context,
          // so redact secrets and neutralize injection BEFORE it gets there.
          let content = JSON.stringify(result.success ? result.data : { error: result.error });
          if (result.success) {
            const scan = sanitizeToolOutput(content);
            content = scan.text;
            if (scan.redactions.length > 0 || scan.injectionFlags.length > 0) {
              log.warn('Tool output sanitized', {
                runId,
                tool: toolCall.name,
                redactions: scan.redactions,
                injection: scan.injectionFlags,
              });
            }
          }
          messages.push({ role: 'tool', content, tool_call_id: toolCall.id });
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          log.error('Tool execution failed', { tool: toolCall.name, error });
          this.activity?.recordToolCall(toolCall.name, toolCall.args, false);
          yield { type: 'tool_error', toolName: toolCall.name, error };
          messages.push({
            role: 'tool',
            content: JSON.stringify({ error }),
            tool_call_id: toolCall.id,
          });
        }
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

  private buildSystemPrompt(ctx: {
    activeWindow?: string;
    screenText?: string;
    relevantMemories?: string[];
    warmFacts?: string[];
    conversationSummary?: string;
    playbookHint?: string;
  }, plan: string[] = []): string {
    const parts = [
      `Tu es CatDesk, un assistant IA desktop local tournant sur la machine de l'utilisateur.`,
      `Tu as accès à des outils pour interagir avec le système.`,
      `Date et heure actuelles : ${new Date().toLocaleString('fr-FR')}`,
      `Système : Windows 11`,
    ];

    if (plan.length > 0) {
      const numbered = plan.map((s, i) => `${i + 1}. ${s}`).join('\n');
      parts.push(`\nPlan à suivre pour accomplir la tâche :\n${numbered}\n(Suis ce plan étape par étape, en utilisant les outils au besoin.)`);
    }

    if (ctx.activeWindow) {
      parts.push(`Fenêtre active : ${ctx.activeWindow}`);
    }

    if (ctx.screenText) {
      parts.push(`\nContenu visible à l'écran :\n${ctx.screenText.slice(0, 1500)}`);
    }

    if (ctx.conversationSummary) {
      parts.push(`\nRésumé de la conversation jusqu'ici :\n${ctx.conversationSummary}`);
    }

    if (ctx.playbookHint) {
      parts.push(`\nMémoire de stratégie : ${ctx.playbookHint}`);
    }

    if (ctx.warmFacts && ctx.warmFacts.length > 0) {
      parts.push(`\nCe que tu sais de l'utilisateur (mémoire long terme) :\n${ctx.warmFacts.join('\n')}`);
    }

    if (ctx.relevantMemories && ctx.relevantMemories.length > 0) {
      parts.push(`\nSouvenirs pertinents :\n${ctx.relevantMemories.join('\n')}`);
    }

    parts.push(
      `\nChoix des outils (préfère TOUJOURS l'outil dédié plutôt que run_subagent) :`,
      `- Voir / lister les tâches récurrentes déjà planifiées ("mes dailys", "tâches planifiées") → list_scheduled_tasks`,
      `- Créer une tâche récurrente (quotidienne, etc.) → schedule_task (schedule "daily", "every 6h"… + une description de tâche)`,
      `- Revue de presse tech à publier (récup + résumés + envoi Discord, tout-en-un) → post_tech_news_discord`,
      `- Récupérer les actus tech sans publier → fetch_tech_news`,
      `- run_subagent UNIQUEMENT pour déléguer une tâche complexe et ponctuelle qu'aucun outil dédié ne couvre — jamais pour planifier ou lister des tâches.`,
    );

    parts.push(
      `\nRègles importantes :`,
      `- Quand un outil peut répondre, APPELLE-le directement. N'écris jamais l'appel en texte/JSON et ne décris pas comment l'utiliser.`,
      `- Après le résultat d'un outil, donne une réponse courte en langage naturel (1-3 phrases). Pas de JSON, pas de bloc de code sauf si on te le demande.`,
      `- Demande confirmation avant les actions irréversibles`,
      `- Réponds TOUJOURS en français sauf instruction contraire`,
      `- Sois concis et précis`,
    );

    return parts.join('\n');
  }
}
