import { z } from 'zod';
import type { ToolResult } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { jsonSchemaFrom } from '../base/zodSchema';
import type { CronScheduler } from '../../CronScheduler';
import { validScheduleFormats } from '../../CronScheduler';

const argsSchema = z.object({
  task: z
    .string()
    .min(1)
    .describe('Agent task description to run on a recurring schedule (natural language)'),
  schedule: z
    .string()
    .min(1)
    .describe(
      'When to run: "every 5m", "every 30m", "every 1h", "every 6h", "every 1d", "hourly", "daily", "weekly"',
    ),
  name: z
    .string()
    .optional()
    .describe('Human-readable label for this job (optional, defaults to truncated task)'),
  enabled: z.boolean().default(true).describe('Whether the job starts active (default: true)'),
});
type Args = z.infer<typeof argsSchema>;

export class ScheduleTaskTool extends BaseTool<Args> {
  readonly name = 'schedule_task';
  readonly description = `Planifie une tâche récurrente exécutée automatiquement par un sous-agent en arrière-plan. Formats: ${validScheduleFormats()}.`;
  readonly category = 'automation' as const;
  readonly riskLevel = 'high' as const;
  readonly requiresConfirmation = true;
  override readonly argsSchema = argsSchema;
  readonly schema = jsonSchemaFrom(argsSchema);

  constructor(private scheduler: CronScheduler) {
    super();
  }

  async execute(rawArgs: Args): Promise<ToolResult> {
    const { task, schedule, name, enabled } = rawArgs;

    if (!task?.trim()) return this.fail('task est requis');
    if (!schedule?.trim()) return this.fail('schedule est requis');

    try {
      const job = this.scheduler.addJob(task.trim(), schedule.trim(), {
        ...(name !== undefined ? { name } : {}),
        ...(enabled !== undefined ? { enabled } : {}),
      });

      return this.ok({
        id: job.id,
        name: job.name,
        schedule: job.schedule,
        task: job.task,
        enabled: job.enabled,
        nextRun: new Date(job.nextRunAt).toISOString(),
        message: `Tâche planifiée avec succès. Prochaine exécution: ${new Date(job.nextRunAt).toLocaleString('fr-FR')}`,
      });
    } catch (err) {
      return this.fail(err instanceof Error ? err.message : String(err));
    }
  }
}
