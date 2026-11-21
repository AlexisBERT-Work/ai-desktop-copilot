import { z } from 'zod';
import type { ToolResult } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { jsonSchemaFrom } from '../base/zodSchema';
import { DesktopHost } from '../../lib/desktopHost';

const argsSchema = z.object({
  window: z.string().min(1).max(200).describe("Titre (ou partie), nom d'appli ou id de la fenêtre"),
  action: z
    .enum(['focus', 'minimize', 'maximize', 'restore', 'close'])
    .describe('focus = premier plan, close = demande de fermeture'),
});
type Args = z.infer<typeof argsSchema>;

/**
 * Actions bornées sur une fenêtre : premier plan, réduire, agrandir,
 * restaurer, demande de fermeture. `close` envoie `WM_CLOSE` : l'appli garde
 * la main (elle peut proposer d'enregistrer), rien n'est tué. Aucune frappe ni
 * aucun clic dans la fenêtre. Risque `high` : confirmation à chaque appel, le
 * dialogue montre la fenêtre visée. Le cœur Rust revalide la fenêtre (visible,
 * de premier niveau, jamais CatDesk) et audite l'action.
 */
export class WindowActionTool extends BaseTool<Args> {
  readonly name = 'window_action';
  readonly description =
    "Met une fenêtre au premier plan, la réduit, l'agrandit, la restaure ou demande sa fermeture.";
  readonly category = 'screen' as const;
  readonly riskLevel = 'high' as const;
  readonly requiresConfirmation = true;
  override readonly argsSchema = argsSchema;
  readonly schema = jsonSchemaFrom(argsSchema);

  constructor(private readonly host: () => DesktopHost = () => DesktopHost.get()) {
    super();
  }

  async execute(args: Args): Promise<ToolResult> {
    const result = await this.host().request('window_action', {
      window: args.window.trim(),
      action: args.action,
    });
    return result.ok ? this.ok(result.data) : this.fail(result.error);
  }
}
