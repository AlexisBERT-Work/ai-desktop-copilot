import type { ToolResult } from '@neurodesk/shared-types';
import { TOOL_SCHEMAS } from '@neurodesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { BrowserManager } from '../../lib/browserManager';

interface BrowserGetTextArgs {
  selector?: string;
  max_chars?: number;
}

export class BrowserGetTextTool extends BaseTool {
  readonly name = 'browser_get_text';
  readonly description = 'Extrait le texte visible de la page actuelle (ou d\'un élément ciblé par CSS selector). Utile pour lire le contenu d\'une page après navigation.';
  readonly category = 'browser' as const;
  readonly riskLevel = 'low' as const;
  readonly requiresConfirmation = false;
  readonly schema = TOOL_SCHEMAS.browser_get_text;

  async execute(rawArgs: unknown): Promise<ToolResult> {
    const { selector, max_chars } = rawArgs as BrowserGetTextArgs;

    if (!BrowserManager.get().isOpen()) {
      return this.fail('Aucune page ouverte — utilise browser_navigate d\'abord');
    }

    try {
      const text = await BrowserManager.get().getText({
        ...(selector !== undefined ? { selector } : {}),
        ...(max_chars !== undefined ? { maxChars: max_chars } : {}),
      });
      return this.ok({
        text,
        charCount: text.length,
        url: BrowserManager.get().getCurrentUrl(),
        ...(text.length === (max_chars ?? 20_000) ? { truncated: true } : {}),
      });
    } catch (err) {
      return this.fail(`Extraction texte échouée: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
