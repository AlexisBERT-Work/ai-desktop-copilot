import type { ToolResult } from '@catdesk/shared-types';
import { TOOL_SCHEMAS } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { BrowserManager } from '../../lib/browserManager';

interface BrowserClickArgs {
  selector: string;
  timeout_ms?: number;
}

export class BrowserClickTool extends BaseTool {
  readonly name = 'browser_click';
  readonly description = 'Clique sur un élément de la page identifié par un sélecteur CSS. Exemple: "button#submit", "a[href=\'/login\']", "text=Se connecter".';
  readonly category = 'browser' as const;
  readonly riskLevel = 'high' as const;
  readonly requiresConfirmation = true;
  readonly schema = TOOL_SCHEMAS.browser_click;

  async execute(rawArgs: unknown): Promise<ToolResult> {
    const { selector, timeout_ms } = rawArgs as BrowserClickArgs;

    if (!selector?.trim()) return this.fail('selector est requis');
    if (!BrowserManager.get().isOpen()) {
      return this.fail('Aucune page ouverte — utilise browser_navigate d\'abord');
    }

    try {
      await BrowserManager.get().click(selector.trim(), timeout_ms);
      return this.ok({
        clicked: selector,
        url: BrowserManager.get().getCurrentUrl(),
      });
    } catch (err) {
      return this.fail(`Clic échoué sur "${selector}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
