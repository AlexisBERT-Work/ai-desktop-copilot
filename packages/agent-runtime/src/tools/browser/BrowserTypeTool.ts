import { z } from 'zod';
import type { ToolResult } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { jsonSchemaFrom } from '../base/zodSchema';
import { BrowserManager } from '../../lib/browserManager';

const argsSchema = z.object({
  selector: z.string().min(1).describe('CSS selector of the input/textarea to fill'),
  text: z.string().describe('Text to type into the element'),
  clear_first: z.boolean().default(true).describe('Clear existing content before typing'),
  timeout_ms: z.number().default(10_000).describe('Max time to wait for element'),
});
type Args = z.infer<typeof argsSchema>;

export class BrowserTypeTool extends BaseTool<Args> {
  readonly name = 'browser_type';
  readonly description =
    'Saisit du texte dans un champ de formulaire (input, textarea) identifié par un sélecteur CSS.';
  readonly category = 'browser' as const;
  readonly riskLevel = 'high' as const;
  readonly requiresConfirmation = true;
  override readonly argsSchema = argsSchema;
  readonly schema = jsonSchemaFrom(argsSchema);

  async execute(rawArgs: Args): Promise<ToolResult> {
    const { selector, text, clear_first, timeout_ms } = rawArgs;

    if (!selector?.trim()) return this.fail('selector est requis');
    if (text === undefined || text === null) return this.fail('text est requis');
    if (!BrowserManager.get().isOpen()) {
      return this.fail("Aucune page ouverte — utilise browser_navigate d'abord");
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
      return this.fail(
        `Saisie échouée sur "${selector}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
