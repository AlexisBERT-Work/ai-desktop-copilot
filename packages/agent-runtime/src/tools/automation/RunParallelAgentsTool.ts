import { z } from 'zod';
import type { ToolResult } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { jsonSchemaFrom } from '../base/zodSchema';
import type { SubAgentRunner } from '../../SubAgentRunner';

const MAX_PARALLEL = 8;

const argsSchema = z.object({
  tasks: z
    .array(z.string())
    .describe('Independent task descriptions to execute simultaneously (max 8)'),
  max_iterations: z.number().default(5).describe('Max ReAct iterations per sub-agent'),
});
type Args = z.infer<typeof argsSchema>;

export class RunParallelAgentsTool extends BaseTool<Args> {
  readonly name = 'run_parallel_agents';
  readonly description = `Lance jusqu'à ${MAX_PARALLEL} sous-agents en parallèle, chacun sur une tâche indépendante. Tous s'exécutent simultanément et les résultats sont agrégés une fois que tous ont terminé.`;
  readonly category = 'automation' as const;
  readonly riskLevel = 'medium' as const;
  readonly requiresConfirmation = false;
  override readonly argsSchema = argsSchema;
  readonly schema = jsonSchemaFrom(argsSchema);

  constructor(private runner: SubAgentRunner) {
    super();
  }

  async execute(rawArgs: Args): Promise<ToolResult> {
    const { tasks, max_iterations = 5 } = rawArgs;

    if (!Array.isArray(tasks) || tasks.length === 0) {
      return this.fail('tasks est requis (tableau non-vide de strings)');
    }
    if (tasks.length > MAX_PARALLEL) {
      return this.fail(
        `Maximum ${MAX_PARALLEL} tâches parallèles autorisées (reçu: ${tasks.length})`,
      );
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
        ...(results[i] ?? {
          success: false,
          output: '',
          toolsUsed: [],
          iterations: 0,
          durationMs: 0,
          error: 'no result',
        }),
      })),
    });
  }
}
