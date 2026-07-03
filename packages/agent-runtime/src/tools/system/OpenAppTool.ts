import type { ToolResult } from '@catdesk/shared-types';
import { TOOL_SCHEMAS } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';

interface Args {
  name: string;
  args?: string;
}

// Interpréteurs et LOLBins qui exécutent du code arbitraire : les autoriser via
// open_app en ferait un contournement de run_command (qui est `high` + blocklist).
// On les refuse ici — pour exécuter une commande, il y a run_command.
const BLOCKED_EXECUTABLES = new Set([
  'powershell', 'powershell_ise', 'pwsh',
  'cmd', 'command',
  'wscript', 'cscript', 'mshta', 'hh',
  'rundll32', 'regsvr32', 'regasm', 'regsvcs', 'installutil',
  'msbuild', 'cmstp', 'msiexec', 'conhost',
  'bash', 'sh', 'wsl', 'busybox',
  'python', 'python3', 'py', 'node', 'ruby', 'perl', 'php',
]);

/** Basename sans dossier ni extension `.exe`, en minuscules. */
function executableBasename(name: string): string {
  const last = name.trim().replace(/\\/g, '/').split('/').pop() ?? '';
  return last.toLowerCase().replace(/\.(exe|com|bat|cmd)$/i, '');
}

/** Exporté pour les tests : validation du nom d'application. */
export function validateAppName(name: string): string | null {
  if (!name || name.trim().length === 0) return 'name est requis';
  if (/[\r\n\0]/.test(name)) return 'name contient des caractères interdits';
  if (name.length > 500) return 'name trop long';
  if (BLOCKED_EXECUTABLES.has(executableBasename(name))) {
    return `Interpréteur/exécutable non autorisé via open_app (utilise run_command): ${name}`;
  }
  return null;
}

export class OpenAppTool extends BaseTool {
  name = 'open_app';
  description =
    "Ouvre une application Windows (nom d'exécutable, chemin, ou nom d'app: notepad, code, chrome…)";
  category = 'system' as const;
  // `high` (pas `medium`) : lancer un exécutable arbitraire équivaut à
  // run_command. `high` retire aussi l'auto-approbation « se souvenir » de session.
  riskLevel = 'high' as const;
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
