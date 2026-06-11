import type { ToolResult } from '@neurodesk/shared-types';
import { TOOL_SCHEMAS } from '@neurodesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { BrowserManager } from '../../lib/browserManager';

interface BrowserNavigateArgs {
  url: string;
  wait_until?: 'load' | 'domcontentloaded' | 'networkidle';
  timeout_ms?: number;
}

export class BrowserNavigateTool extends BaseTool {
  readonly name = 'browser_navigate';
  readonly description = 'Ouvre une URL dans un vrai navigateur (exécute le JavaScript). À utiliser pour les pages JS/SPA que read_webpage ne peut pas lire, ou les sites interactifs. Astuce : wait_until="networkidle" pour laisser le contenu dynamique se charger. Puis appelle browser_get_text. Retourne titre, URL finale, status HTTP.';
  readonly category = 'browser' as const;
  readonly riskLevel = 'high' as const;
  readonly requiresConfirmation = true;
  readonly schema = TOOL_SCHEMAS.browser_navigate;

  async execute(rawArgs: unknown): Promise<ToolResult> {
    const { url, wait_until, timeout_ms } = rawArgs as BrowserNavigateArgs;

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
