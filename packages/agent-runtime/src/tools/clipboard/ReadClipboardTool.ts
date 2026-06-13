import type { ToolResult } from '@catdesk/shared-types';
import { TOOL_SCHEMAS } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';

export class ReadClipboardTool extends BaseTool {
  name = 'read_clipboard';
  description = 'Lit le contenu actuel du presse-papier';
  category = 'clipboard' as const;
  riskLevel = 'low' as const;
  requiresConfirmation = false;
  schema = TOOL_SCHEMAS.read_clipboard;

  async execute(_args: unknown): Promise<ToolResult> {
    try {
      // On Windows, use PowerShell to read clipboard
      const { execFile } = await import('child_process');
      const { promisify } = await import('util');
      const exec = promisify(execFile);

      const { stdout } = await exec('powershell.exe', [
        '-NoProfile', '-Command', 'Get-Clipboard'
      ], { timeout: 5000 });

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
