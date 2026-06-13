import type { ToolResult } from '@catdesk/shared-types';
import { TOOL_SCHEMAS } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import type { CronScheduler } from '../../CronScheduler';

interface CancelScheduledTaskArgs {
  id: string;
}

export class CancelScheduledTaskTool extends BaseTool {
  readonly name = 'cancel_scheduled_task';
  readonly description = 'Annule et supprime définitivement une tâche planifiée. Utilise list_scheduled_tasks pour obtenir les IDs.';
  readonly category = 'automation' as const;
  readonly riskLevel = 'medium' as const;
  readonly requiresConfirmation = false;
  readonly schema = TOOL_SCHEMAS.cancel_scheduled_task;

  constructor(private scheduler: CronScheduler) {
    super();
  }

  async execute(rawArgs: unknown): Promise<ToolResult> {
    const { id } = rawArgs as CancelScheduledTaskArgs;

    if (!id?.trim()) return this.fail('id est requis');

    const removed = this.scheduler.cancelJob(id.trim());

    if (!removed) {
      return this.fail(`Aucune tâche trouvée avec l'id: ${id}`);
    }

    return this.ok({
      id,
      message: `Tâche ${id} annulée et supprimée.`,
    });
  }
}
