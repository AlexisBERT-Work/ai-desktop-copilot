import type { AgentConfig, AgentStep, ToolCall, PermissionConfig } from '@neurodesk/shared-types';
import type { OllamaClient } from './llm/OllamaClient';
import type { ToolRegistry } from './ToolRegistry';
import type { PermissionEngine } from './permissions/PermissionEngine';
import type { ContextManager } from './ContextManager';
import type { AuditLogger } from './AuditLogger';
import { resolveModel } from './llm/ModelRouter';
import type { Planner } from './llm/Planner';
import type { ActivityTracker } from './ActivityTracker';
import { createLogger } from './logger';

const log = createLogger('agent:orchestrator');

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
  ): AsyncGenerator<AgentStep> {
    const runId = crypto.randomUUID();
    log.info('Run started', { runId, conversationId, model: config.model });
    this.audit.startRun(runId, conversationId, input);

    // Build context (messages + memories + screen context)
    const ctx = await this.context.buildContext(conversationId, input);
    const availableTools = this.tools.getEnabled(config.enabledTools);

    let messages = [...ctx.messages];
    // Add user message
    messages.push({ role: 'user', content: input });

    // Choix du modèle (auto/light/code) une fois par run.
    const model = this.pickModel(input, availableTools.length > 0, config);

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

    const systemPrompt = this.buildSystemPrompt(ctx, plan);

    const maxIterations = config.maxIterations ?? this.defaultMaxIterations;
    let iterations = 0;

    while (iterations < maxIterations) {
      iterations++;
      log.debug('Iteration', { runId, iteration: iterations });

      // ─── LLM Call ───────────────────────────────────────────
      const stream = this.llm.streamChat({
        model,
        messages,
        tools: availableTools.map(t => t.toOllamaSchema()),
        system: systemPrompt,
        temperature: config.temperature ?? 0.7,
      });

      let fullResponse = '';
      const toolCalls: ToolCall[] = [];

      for await (const chunk of stream) {
        if (chunk.type === 'token') {
          fullResponse += chunk.content;
          yield { type: 'token', content: chunk.content };
        } else if (chunk.type === 'tool_call') {
          // Tool calls come at end of stream
          toolCalls.push({
            id: chunk.toolCall.id,
            name: chunk.toolCall.function.name,
            args: JSON.parse(chunk.toolCall.function.arguments),
          });
        } else if (chunk.type === 'error') {
          yield { type: 'error', content: chunk.error };
          this.audit.completeRun(runId, 'error');
          return;
        }
      }

      // ─── No tool calls → final answer ─────────────────────
      if (toolCalls.length === 0) {
        this.audit.completeRun(runId, 'success', fullResponse);
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
          function: { name: tc.name, arguments: JSON.stringify(tc.args) },
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
          const result = await this.tools.execute(toolCall.name, toolCall.args);
          this.audit.logToolCall(runId, toolCall.name, toolCall.args, result);
          this.activity?.recordToolCall(toolCall.name, toolCall.args, result.success);

          yield { type: 'tool_result', toolName: toolCall.name, result };
          messages.push({
            role: 'tool',
            content: JSON.stringify(result.success ? result.data : { error: result.error }),
            tool_call_id: toolCall.id,
          });
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
    yield {
      type: 'error',
      content: `Limite d'itérations atteinte (${maxIterations}). Réponse partielle disponible.`,
      code: 'MAX_ITERATIONS',
    };
  }

  private buildSystemPrompt(ctx: {
    activeWindow?: string;
    screenText?: string;
    relevantMemories?: string[];
  }, plan: string[] = []): string {
    const parts = [
      `Tu es NeuroDesk, un assistant IA desktop local tournant sur la machine de l'utilisateur.`,
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

    if (ctx.relevantMemories && ctx.relevantMemories.length > 0) {
      parts.push(`\nSouvenirs pertinents :\n${ctx.relevantMemories.join('\n')}`);
    }

    parts.push(
      `\nRègles importantes :`,
      `- Utilise les outils avec parcimonie et seulement si nécessaire`,
      `- Demande confirmation avant les actions irréversibles`,
      `- Réponds en français sauf instruction contraire`,
      `- Sois concis et précis`,
    );

    return parts.join('\n');
  }
}
