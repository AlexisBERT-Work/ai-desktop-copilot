import { z } from 'zod';
import type { ToolResult } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { jsonSchemaFrom } from '../base/zodSchema';
import { runProcess } from '../../lib/runProcess';

const argsSchema = z.object({});
type Args = z.infer<typeof argsSchema>;

export class ReadClipboardTool extends BaseTool<Args> {
  name = 'read_clipboard';
  description = 'Lit le contenu actuel du presse-papier';
  category = 'clipboard' as const;
  riskLevel = 'low' as const;
  requiresConfirmation = false;
  override readonly argsSchema = argsSchema;
  readonly schema = jsonSchemaFrom(argsSchema);

  async execute(_args: Args): Promise<ToolResult> {
    try {
      // On Windows, use PowerShell to read clipboard
      const { stdout } = await runProcess(
        'powershell.exe',
        ['-NoProfile', '-Command', 'Get-Clipboard'],
        { timeoutMs: 5_000 },
      );

      const content = stdout.trim();
      return this.ok({
        content,
        length: content.length,
        isEmpty: content.length === 0,
      });
    } catch (err) {
      return this.fail(`Impossible de lire le presse-papier: ${String(err)}`);
    }
  }
}
