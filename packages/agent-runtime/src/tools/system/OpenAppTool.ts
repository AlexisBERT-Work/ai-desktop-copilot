import type { ToolResult } from '@catdesk/shared-types';
import { TOOL_SCHEMAS } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';

interface Args {
  name: string;
  args?: string;
}

/** Exporté pour les tests : validation du nom d'application. */
export function validateAppName(name: string): string | null {
  if (!name || name.trim().length === 0) return 'name est requis';
  if (/[\r\n\0]/.test(name)) return 'name contient des caractères interdits';
  if (name.length > 500) return 'name trop long';
  return null;
}

export class OpenAppTool extends BaseTool {
  name = 'open_app';
  description =
    "Ouvre une application Windows (nom d'exécutable, chemin, ou nom d'app: notepad, code, chrome…)";
  category = 'system' as const;
  riskLevel = 'medium' as const;
  requiresConfirmation = true;
  schema = TOOL_SCHEMAS.open_app;

  async execute(rawArgs: unknown): Promise<ToolResult> {
    const args = rawArgs as Args;
    const invalid = validateAppName(args.name ?? '');
    if (invalid) return this.fail(invalid);
    if (args.args !== undefined && /[\r\n\0]/.test(args.args)) {
      return this.fail('args contient des caractères interdits');
    }

    // Start-Process gère les noms simples (notepad), les chemins complets et
    // les apps du PATH. Échappement single-quote PowerShell pour neutraliser
    // toute injection dans -Command.
    const psEscape = (s: string): string => s.replace(/'/g, "''");
    let command = `Start-Process -FilePath '${psEscape(args.name)}'`;
    if (args.args !== undefined && args.args.trim().length > 0) {
      command += ` -ArgumentList '${psEscape(args.args)}'`;
    }

    try {
      const { execFile } = await import('child_process');
      const { promisify } = await import('util');
      const exec = promisify(execFile);

      await exec('powershell.exe', ['-NoProfile', '-Command', command], { timeout: 15000 });

      return this.ok({ launched: true, app: args.name, ...(args.args ? { args: args.args } : {}) });
    } catch (err) {
      return this.fail(`Impossible d'ouvrir ${args.name}: ${String(err)}`);
    }
  }
}
