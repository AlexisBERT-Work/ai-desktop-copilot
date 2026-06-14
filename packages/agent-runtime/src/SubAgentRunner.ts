import type { AgentConfig } from '@catdesk/shared-types';
import type { AgentOrchestrator } from './AgentOrchestrator';
import type { ToolRegistry } from './ToolRegistry';
import { createLogger } from './logger';

const log = createLogger('agent:subagent');

// Tools that sub-agents must NOT be allowed to invoke (prevent infinite recursion)
const EXCLUDED_FROM_SUBAGENTS = new Set(['run_subagent', 'run_parallel_agents']);

export interface SubAgentResult {
  success: boolean;
  output: string;
  toolsUsed: string[];
  iterations: number;
  durationMs: number;
  error?: string;
}

export interface SubAgentOptions {
  maxIterations?: number;
  temperature?: number;
  enabledTools?: string[];
  /**
   * Curated context the orchestrator chooses to hand down (§6). A sub-agent
   * runs in an isolated window with a fresh conversation, so without this it
   * only sees the bare task. The research is clear: no-context fails for lack
   * of critical detail, full-context dilutes — curated wins.
   */
  context?: string;
}

/**
 * Thin wrapper around AgentOrchestrator for isolated sub-task execution.
 * Each sub-agent gets a fresh ephemeral conversationId and cannot spawn further sub-agents.
 */
export class SubAgentRunner {
  constructor(
    private orchestrator: AgentOrchestrator,
    private toolRegistry: ToolRegistry,
    readonly defaultModel: string,
  ) {}

  private subAgentToolList(): string[] {
    return this.toolRegistry.listNames().filter(n => !EXCLUDED_FROM_SUBAGENTS.has(n));
  }

  async run(task: string, opts: SubAgentOptions = {}): Promise<SubAgentResult> {
    const {
      maxIterations = 5,
      temperature = 0.3,
      enabledTools = this.subAgentToolList(),
      context,
    } = opts;

    // Curated context first, then the task — the sub-agent has nothing else.
    const input = context?.trim()
      ? `Contexte fourni par l'agent principal (utilise-le, ne redemande pas ces infos) :\n${context.trim()}\n\n---\n\nTâche à accomplir :\n${task}`
      : task;

    const conversationId = `sub-${crypto.randomUUID()}`;
    const config: AgentConfig = {
      model: this.defaultModel,
      maxIterations,
      temperature,
      enabledTools,
    };

    log.debug('Sub-agent started', { conversationId, task: task.slice(0, 80) });
    const startMs = Date.now();

    const toolsStarted: string[] = [];
    let output = '';
    let success = false;
    let error: string | undefined;
    let iterations = 0;

    for await (const step of this.orchestrator.process(input, conversationId, config)) {
      if (step.type === 'done') {
        output = step.content;
        success = true;
      } else if (step.type === 'error') {
        error = step.content;
        output = step.content;
      } else if (step.type === 'tool_start') {
        toolsStarted.push(step.toolName);
        iterations++;
      }
    }

    const durationMs = Date.now() - startMs;
    log.debug('Sub-agent finished', { conversationId, success, durationMs });

    return {
      success,
      output,
      toolsUsed: [...new Set(toolsStarted)],
      iterations,
      durationMs,
      ...(error !== undefined ? { error } : {}),
    };
  }

  async runParallel(tasks: string[], opts: SubAgentOptions = {}): Promise<SubAgentResult[]> {
    log.info('Running parallel sub-agents', { count: tasks.length });
    return Promise.all(tasks.map(task => this.run(task, opts)));
  }
}
