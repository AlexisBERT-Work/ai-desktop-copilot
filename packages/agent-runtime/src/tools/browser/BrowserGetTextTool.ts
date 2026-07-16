import { z } from 'zod';
import type { ToolResult } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { jsonSchemaFrom } from '../base/zodSchema';
import { BrowserManager } from '../../lib/browserManager';

const argsSchema = z.object({
  selector: z
    .string()
    .optional()
    .describe(
      'CSS selector to extract text from a specific element (optional, defaults to full page)',
    ),
  max_chars: z.number().default(20000).describe('Max characters to return'),
});
type Args = z.infer<typeof argsSchema>;

export class BrowserGetTextTool extends BaseTool<Args> {
  readonly name = 'browser_get_text';
  readonly description =
    "Extrait le texte visible de la page courante (rendu JS inclus), ou d'un élément ciblé par CSS selector. À appeler après browser_navigate pour lire une page JS/SPA que read_webpage n'a pas pu lire.";
  readonly category = 'browser' as const;
  readonly riskLevel = 'low' as const;
  readonly requiresConfirmation = false;
  override readonly argsSchema = argsSchema;
  readonly schema = jsonSchemaFrom(argsSchema);

  async execute(rawArgs: Args): Promise<ToolResult> {
    const { selector, max_chars } = rawArgs;

    if (!BrowserManager.get().isOpen()) {
      return this.fail("Aucune page ouverte — utilise browser_navigate d'abord");
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
      return this.fail(
        `Extraction texte échouée: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
