import { z } from 'zod';
import type { ToolResult } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { jsonSchemaFrom } from '../base/zodSchema';
import { BrowserManager } from '../../lib/browserManager';

const argsSchema = z.object({
  url: z.string().min(1).describe('URL to navigate to (must start with http:// or https://)'),
  wait_until: z
    .enum(['load', 'domcontentloaded', 'networkidle'])
    .default('domcontentloaded')
    .describe('When to consider navigation complete'),
  timeout_ms: z.number().default(30_000).describe('Navigation timeout in milliseconds'),
});
type Args = z.infer<typeof argsSchema>;

export class BrowserNavigateTool extends BaseTool<Args> {
  readonly name = 'browser_navigate';
  readonly description =
    'Ouvre une URL dans un vrai navigateur (exécute le JavaScript). À utiliser pour les pages JS/SPA que read_webpage ne peut pas lire, ou les sites interactifs. Astuce : wait_until="networkidle" pour laisser le contenu dynamique se charger. Puis appelle browser_get_text. Retourne titre, URL finale, status HTTP.';
  readonly category = 'browser' as const;
  readonly riskLevel = 'high' as const;
  readonly requiresConfirmation = true;
  override readonly argsSchema = argsSchema;
  readonly schema = jsonSchemaFrom(argsSchema);

  async execute(rawArgs: Args): Promise<ToolResult> {
    const { url, wait_until, timeout_ms } = rawArgs;

    if (!url?.trim()) return this.fail('url est requis');
    if (!/^https?:\/\//i.test(url)) return this.fail('url doit commencer par http:// ou https://');

    try {
      const result = await BrowserManager.get().navigate(url.trim(), {
        ...(wait_until !== undefined ? { waitUntil: wait_until } : {}),
        ...(timeout_ms !== undefined ? { timeoutMs: timeout_ms } : {}),
      });
      return this.ok(result);
    } catch (err) {
      return this.fail(`Navigation échouée: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
