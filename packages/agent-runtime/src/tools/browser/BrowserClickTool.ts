import { z } from 'zod';
import type { ToolResult } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { jsonSchemaFrom } from '../base/zodSchema';
import { BrowserManager } from '../../lib/browserManager';
import { handoffReport } from '../../lib/browserHandoff';
import { blockedWritesReport } from './blockedWrites';
import { currentPageUrl } from './currentPage';

const argsSchema = z.object({
  selector: z.string().min(1).describe('CSS selector or text locator of the element to click'),
  timeout_ms: z.number().default(10_000).describe('Max time to wait for element to be clickable'),
});
type Args = z.infer<typeof argsSchema>;

export class BrowserClickTool extends BaseTool<Args> {
  readonly name = 'browser_click';
  readonly description =
    'Clique sur un élément de la page identifié par un sélecteur CSS. Exemple: "button#submit", "a[href=\'/login\']", "text=Se connecter".';
  readonly category = 'browser' as const;
  readonly riskLevel = 'high' as const;
  readonly requiresConfirmation = true;
  override readonly argsSchema = argsSchema;
  readonly schema = jsonSchemaFrom(argsSchema);

  /** Site de l'accord « pour ce site » : celui de la page courante. */
  override targetUrl(): string | undefined {
    return currentPageUrl();
  }

  async execute(rawArgs: Args): Promise<ToolResult> {
    const { selector, timeout_ms } = rawArgs;

    if (!selector?.trim()) return this.fail('selector est requis');
    if (!BrowserManager.get().isOpen()) {
      return this.fail("Aucune page ouverte — utilise browser_navigate d'abord");
    }

    try {
      // CAPTCHA, code à usage unique, paiement : à l'utilisateur, même autorisé.
      const handoff = await BrowserManager.get().detectHandoff();
      if (handoff !== null) {
        return this.ok(handoffReport(handoff, BrowserManager.get().getCurrentUrl()));
      }
      const blocked = await BrowserManager.get().click(selector.trim(), timeout_ms);
      return this.ok({
        clicked: selector,
        url: BrowserManager.get().getCurrentUrl(),
        ...blockedWritesReport(blocked, 'interact'),
      });
    } catch (err) {
      return this.fail(
        `Clic échoué sur "${selector}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
