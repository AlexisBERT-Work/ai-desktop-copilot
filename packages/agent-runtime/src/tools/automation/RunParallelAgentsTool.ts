import type { ToolResult } from '@catdesk/shared-types';
import { TOOL_SCHEMAS } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import type { SubAgentRunner } from '../../SubAgentRunner';

const MAX_PARALLEL = 8;

interface RunParallelAgentsArgs {
  tasks: string[];
  max_iterations?: number;
}

export class RunParallelAgentsTool extends BaseTool {
  readonly name = 'run_parallel_agents';
  readonly description = `Lance jusqu'à ${MAX_PARALLEL} sous-agents en parallèle, chacun sur une tâche indépendante. Tous s'exécutent simultanément et les résultats sont agrégés une fois que tous ont terminé.`;
  readonly category = 'automation' as const;
  readonly riskLevel = 'medium' as const;
  readonly requiresConfirmation = false;
  readonly schema = TOOL_SCHEMAS.run_parallel_agents;

  constructor(private runner: SubAgentRunner) {
    super();
  }

  async execute(rawArgs: unknown): Promise<ToolResult> {
    const { tasks, max_iterations = 5 } = rawArgs as RunParallelAgentsArgs;

    if (!Array.isArray(tasks) || tasks.length === 0) {
      return this.fail('tasks est requis (tableau non-vide de strings)');
    }
    if (tasks.length > MAX_PARALLEL) {
      return this.fail(`Maximum ${MAX_PARALLEL} tâches parallèles autorisées (reçu: ${tasks.length})`);
    }
    if (tasks.some(t => typeof t !== 'string' || !t.trim())) {
      return this.fail('Chaque tâche doit être une string non-vide');
    }

    const capped = Math.min(Math.max(1, max_iterations), 8);
    const startedAt = Date.now();

    const results = await this.runner.runParallel(tasks, { maxIterations: capped });

    const successful = results.filter(r => r.success).length;
    const failed = results.length - successful;

    return this.ok({
      totalTasks: tasks.length,
      successful,
      failed,
      durationMs: Date.now() - startedAt,
      results: tasks.map((task, i) => ({
        task,
        // guaranteed by map alignment
        ...(results[i] ?? { success: false, output: '', toolsUsed: [], iterations: 0, durationMs: 0, error: 'no result' }),
      })),
    });
  }
}
