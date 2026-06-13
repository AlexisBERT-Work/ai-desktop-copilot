import type { ToolResult } from '@catdesk/shared-types';
import { TOOL_SCHEMAS } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import type { CronScheduler } from '../../CronScheduler';

export class ListScheduledTasksTool extends BaseTool {
  readonly name = 'list_scheduled_tasks';
  readonly description = 'Liste toutes les tâches planifiées avec leur statut, dernière exécution, prochain déclenchement et résultat.';
  readonly category = 'automation' as const;
  readonly riskLevel = 'low' as const;
  readonly requiresConfirmation = false;
  readonly schema = TOOL_SCHEMAS.list_scheduled_tasks;

  constructor(private scheduler: CronScheduler) {
    super();
  }

  async execute(_rawArgs: unknown): Promise<ToolResult> {
    const jobs = this.scheduler.listJobs();

    return this.ok({
      count: jobs.length,
      tasks: jobs.map(j => ({
        id: j.id,
        name: j.name,
        schedule: j.schedule,
        task: j.task,
        enabled: j.enabled,
        runCount: j.runCount,
        createdAt: new Date(j.createdAt).toISOString(),
        ...(j.lastRunAt !== undefined ? { lastRunAt: new Date(j.lastRunAt).toISOString() } : {}),
        nextRunAt: new Date(j.nextRunAt).toISOString(),
        ...(j.lastResult !== undefined ? { lastResult: j.lastResult } : {}),
        ...(j.lastError !== undefined ? { lastError: j.lastError } : {}),
      })),
    });
  }
}
