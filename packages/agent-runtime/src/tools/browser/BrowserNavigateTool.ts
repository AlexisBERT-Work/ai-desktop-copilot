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
  readonly description = 'Ouvre ou navigue vers une URL dans le navigateur headless. Retourne le titre, l\'URL finale et le status HTTP.';
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
