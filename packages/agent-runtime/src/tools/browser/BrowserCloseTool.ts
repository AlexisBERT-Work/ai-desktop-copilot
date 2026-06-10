import type { ToolResult } from '@neurodesk/shared-types';
import { TOOL_SCHEMAS } from '@neurodesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { BrowserManager } from '../../lib/browserManager';

export class BrowserCloseTool extends BaseTool {
  readonly name = 'browser_close';
  readonly description = 'Ferme le navigateur headless et libère les ressources. À appeler quand les interactions web sont terminées.';
  readonly category = 'browser' as const;
  readonly riskLevel = 'low' as const;
  readonly requiresConfirmation = false;
  readonly schema = TOOL_SCHEMAS.browser_close;

  async execute(_rawArgs: unknown): Promise<ToolResult> {
    const wasOpen = BrowserManager.get().isOpen();
    await BrowserManager.get().close();
    return this.ok({
      closed: wasOpen,
      message: wasOpen ? 'Navigateur fermé.' : 'Aucun navigateur ouvert.',
    });
  }
}
