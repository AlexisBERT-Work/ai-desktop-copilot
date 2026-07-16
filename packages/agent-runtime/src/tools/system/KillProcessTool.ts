import { execFile } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';
import type { ToolResult } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { jsonSchemaFrom } from '../base/zodSchema';

const exec = promisify(execFile);

const argsSchema = z.object({
  pid: z.number().int().positive().describe('Process ID to terminate'),
  force: z.boolean().default(false).describe('Force kill (taskkill /F) instead of a graceful stop'),
});
type Args = z.infer<typeof argsSchema>;

// PIDs that must never be killed (system/idle on Windows).
const PROTECTED_PIDS = new Set([0, 4]);

export class KillProcessTool extends BaseTool<Args> {
  readonly name = 'kill_process';
  readonly description =
    "Termine un processus par son PID (par ex. pour libérer un port occupé). Refuse les PID système. Confirmation requise. Utilise inspect_port d'abord pour identifier le bon PID.";
  readonly category = 'system' as const;
  readonly riskLevel = 'high' as const;
  readonly requiresConfirmation = true;
  override readonly argsSchema = argsSchema;
  readonly schema = jsonSchemaFrom(argsSchema);

  async execute({ pid, force }: Args): Promise<ToolResult> {
    if (PROTECTED_PIDS.has(pid)) {
      return this.fail(
        `Le PID ${pid} est protégé (processus système) et ne peut pas être terminé.`,
      );
    }
    if (pid === process.pid) {
      return this.fail("Refus de terminer le propre processus de l'agent.");
    }

    const taskkillArgs = ['/PID', String(pid)];
    if (force) taskkillArgs.push('/F');

    try {
      const { stdout } = await exec('taskkill', taskkillArgs, { windowsHide: true });
      return this.ok({ pid, force, message: stdout.trim() || `Processus ${pid} terminé.` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/not found|introuvable|n'existe pas/i.test(msg)) {
        return this.fail(`Aucun processus avec le PID ${pid}.`);
      }
      if (/access is denied|accès refusé/i.test(msg)) {
        return this.fail(
          `Accès refusé pour terminer le PID ${pid} (essaie force=true ou des droits admin).`,
        );
      }
      return this.fail(`Échec de taskkill: ${msg}`);
    }
  }
}
