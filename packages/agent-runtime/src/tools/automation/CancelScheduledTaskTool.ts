import { z } from 'zod';
import type { ToolResult } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { jsonSchemaFrom } from '../base/zodSchema';
import type { CronScheduler } from '../../CronScheduler';

const argsSchema = z.object({
  id: z.string().min(1).describe('Job ID to cancel — get IDs from list_scheduled_tasks'),
});
type Args = z.infer<typeof argsSchema>;

export class CancelScheduledTaskTool extends BaseTool<Args> {
  readonly name = 'cancel_scheduled_task';
  readonly description =
    'Annule et supprime définitivement une tâche planifiée. Utilise list_scheduled_tasks pour obtenir les IDs.';
  readonly category = 'automation' as const;
  readonly riskLevel = 'medium' as const;
  readonly requiresConfirmation = false;
  override readonly argsSchema = argsSchema;
  readonly schema = jsonSchemaFrom(argsSchema);

  constructor(private scheduler: CronScheduler) {
    super();
  }

  async execute(rawArgs: Args): Promise<ToolResult> {
    const { id } = rawArgs;

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
