import { z } from 'zod';
import type { ToolResult } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { jsonSchemaFrom } from '../base/zodSchema';
import { BrowserManager } from '../../lib/browserManager';

const argsSchema = z.object({});
type Args = z.infer<typeof argsSchema>;

export class BrowserCloseTool extends BaseTool<Args> {
  readonly name = 'browser_close';
  readonly description =
    'Ferme le navigateur headless et libère les ressources. À appeler quand les interactions web sont terminées.';
  readonly category = 'browser' as const;
  readonly riskLevel = 'low' as const;
  readonly requiresConfirmation = false;
  override readonly argsSchema = argsSchema;
  readonly schema = jsonSchemaFrom(argsSchema);

  async execute(_rawArgs: Args): Promise<ToolResult> {
    const wasOpen = BrowserManager.get().isOpen();
    await BrowserManager.get().close();
    return this.ok({
      closed: wasOpen,
      message: wasOpen ? 'Navigateur fermé.' : 'Aucun navigateur ouvert.',
    });
  }
}
