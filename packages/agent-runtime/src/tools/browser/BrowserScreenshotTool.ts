import { z } from 'zod';
import type { ToolResult } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { jsonSchemaFrom } from '../base/zodSchema';
import { BrowserManager } from '../../lib/browserManager';

const argsSchema = z.object({
  full_page: z
    .boolean()
    .default(false)
    .describe('Capture entire scrollable page (default: visible viewport only)'),
  selector: z.string().optional().describe('CSS selector of element to screenshot (optional)'),
});
type Args = z.infer<typeof argsSchema>;

export class BrowserScreenshotTool extends BaseTool<Args> {
  readonly name = 'browser_screenshot';
  readonly description =
    "Prend une capture d'écran de la page actuelle dans le navigateur headless. Retourne une image base64 PNG.";
  readonly category = 'browser' as const;
  readonly riskLevel = 'low' as const;
  readonly requiresConfirmation = false;
  override readonly argsSchema = argsSchema;
  readonly schema = jsonSchemaFrom(argsSchema);

  async execute(rawArgs: Args): Promise<ToolResult> {
    const { full_page, selector } = rawArgs;

    if (!BrowserManager.get().isOpen()) {
      return this.fail("Aucune page ouverte — utilise browser_navigate d'abord");
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
