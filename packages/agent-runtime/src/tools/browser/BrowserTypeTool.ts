import type { ToolResult } from '@catdesk/shared-types';
import { TOOL_SCHEMAS } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { BrowserManager } from '../../lib/browserManager';

interface BrowserTypeArgs {
  selector: string;
  text: string;
  clear_first?: boolean;
  timeout_ms?: number;
}

export class BrowserTypeTool extends BaseTool {
  readonly name = 'browser_type';
  readonly description = 'Saisit du texte dans un champ de formulaire (input, textarea) identifié par un sélecteur CSS.';
  readonly category = 'browser' as const;
  readonly riskLevel = 'high' as const;
  readonly requiresConfirmation = true;
  readonly schema = TOOL_SCHEMAS.browser_type;

  async execute(rawArgs: unknown): Promise<ToolResult> {
    const { selector, text, clear_first, timeout_ms } = rawArgs as BrowserTypeArgs;

    if (!selector?.trim()) return this.fail('selector est requis');
    if (text === undefined || text === null) return this.fail('text est requis');
    if (!BrowserManager.get().isOpen()) {
      return this.fail('Aucune page ouverte — utilise browser_navigate d\'abord');
    }

    try {
      await BrowserManager.get().fill(selector.trim(), text, {
        ...(clear_first !== undefined ? { clearFirst: clear_first } : {}),
        ...(timeout_ms !== undefined ? { timeoutMs: timeout_ms } : {}),
      });
      return this.ok({
        selector,
        charsTyped: text.length,
        url: BrowserManager.get().getCurrentUrl(),
      });
    } catch (err) {
      return this.fail(`Saisie échouée sur "${selector}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
