import type { ToolResult } from '@neurodesk/shared-types';
import { TOOL_SCHEMAS } from '@neurodesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { BrowserManager } from '../../lib/browserManager';

interface BrowserScreenshotArgs {
  full_page?: boolean;
  selector?: string;
}

export class BrowserScreenshotTool extends BaseTool {
  readonly name = 'browser_screenshot';
  readonly description = 'Prend une capture d\'écran de la page actuelle dans le navigateur headless. Retourne une image base64 PNG.';
  readonly category = 'browser' as const;
  readonly riskLevel = 'low' as const;
  readonly requiresConfirmation = false;
  readonly schema = TOOL_SCHEMAS.browser_screenshot;

  async execute(rawArgs: unknown): Promise<ToolResult> {
    const { full_page, selector } = rawArgs as BrowserScreenshotArgs;

    if (!BrowserManager.get().isOpen()) {
      return this.fail('Aucune page ouverte — utilise browser_navigate d\'abord');
    }

    try {
      const imageBase64 = await BrowserManager.get().screenshot({
        ...(full_page !== undefined ? { fullPage: full_page } : {}),
        ...(selector !== undefined ? { selector } : {}),
      });
      return this.ok({
        imageBase64,
        url: BrowserManager.get().getCurrentUrl(),
        format: 'png',
        sizeKB: Math.round((imageBase64.length * 3) / 4 / 1024),
      });
    } catch (err) {
      return this.fail(`Screenshot échoué: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
