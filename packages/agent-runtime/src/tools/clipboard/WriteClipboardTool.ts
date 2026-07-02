import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import type { ToolResult } from '@catdesk/shared-types';
import { TOOL_SCHEMAS } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';

interface Args {
  content: string;
}

const MAX_CHARS = 1_000_000;

export class WriteClipboardTool extends BaseTool {
  name = 'write_clipboard';
  description = 'Écrit du texte dans le presse-papier Windows';
  category = 'clipboard' as const;
  riskLevel = 'medium' as const;
  requiresConfirmation = true;
  schema = TOOL_SCHEMAS.write_clipboard;

  async execute(rawArgs: unknown): Promise<ToolResult> {
    const args = rawArgs as Args;
    if (typeof args.content !== 'string' || args.content.length === 0) {
      return this.fail('content est requis');
    }
    if (args.content.length > MAX_CHARS) {
      return this.fail(`Contenu trop grand: ${args.content.length} caractères (max: ${MAX_CHARS})`);
    }

    // Passage par un fichier temporaire UTF-8 : évite tout problème de quoting
    // PowerShell et préserve les accents (clip.exe mange l'UTF-8).
    const tmpFile = join(tmpdir(), `catdesk-clip-${Date.now()}-${process.pid}.txt`);
    try {
      await writeFile(tmpFile, args.content, 'utf-8');

      const { execFile } = await import('child_process');
      const { promisify } = await import('util');
      const exec = promisify(execFile);

      await exec('powershell.exe', [
        '-NoProfile', '-Command',
        `Get-Content -Raw -Encoding UTF8 -LiteralPath '${tmpFile.replace(/'/g, "''")}' | Set-Clipboard`,
      ], { timeout: 5000 });

      return this.ok({ written: true, length: args.content.length });
    } catch (err) {
      return this.fail(`Impossible d'écrire le presse-papier: ${String(err)}`);
    } finally {
      await unlink(tmpFile).catch(() => undefined);
    }
  }
}
