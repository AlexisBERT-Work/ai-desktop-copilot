import type { ToolResult } from '@catdesk/shared-types';
import { TOOL_SCHEMAS } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import type { CronScheduler } from '../../CronScheduler';
import { validScheduleFormats } from '../../CronScheduler';

interface ScheduleTaskArgs {
  task: string;
  schedule: string;
  name?: string;
  enabled?: boolean;
}

export class ScheduleTaskTool extends BaseTool {
  readonly name = 'schedule_task';
  readonly description = `Planifie une tâche récurrente exécutée automatiquement par un sous-agent en arrière-plan. Formats: ${validScheduleFormats()}.`;
  readonly category = 'automation' as const;
  readonly riskLevel = 'high' as const;
  readonly requiresConfirmation = true;
  readonly schema = TOOL_SCHEMAS.schedule_task;

  constructor(private scheduler: CronScheduler) {
    super();
  }

  async execute(rawArgs: unknown): Promise<ToolResult> {
    const { task, schedule, name, enabled } = rawArgs as ScheduleTaskArgs;

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
