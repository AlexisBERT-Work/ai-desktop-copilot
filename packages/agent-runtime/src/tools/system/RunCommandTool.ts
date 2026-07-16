import { execFile } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';
import type { ToolResult } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { jsonSchemaFrom } from '../base/zodSchema';
import { isCommandBlocked, MAX_COMMAND_LEN } from '../../security/commandPolicy';

const execFileAsync = promisify(execFile);

const argsSchema = z.object({
  command: z.string().min(1).describe('The command to execute'),
  shell: z.enum(['powershell', 'cmd']).default('powershell'),
  workdir: z.string().optional().describe('Working directory'),
  timeoutMs: z.number().max(120_000).default(30_000),
});
type Args = z.infer<typeof argsSchema>;

export class RunCommandTool extends BaseTool<Args> {
  name = 'run_command';
  description =
    'Exécute une commande PowerShell ou CMD. ATTENTION: demande confirmation avant exécution.';
  category = 'system' as const;
  riskLevel = 'high' as const;
  requiresConfirmation = true;
  override readonly argsSchema = argsSchema;
  schema = jsonSchemaFrom(argsSchema);

  async execute(args: Args): Promise<ToolResult> {
    // Safety check (politique partagée — voir security/commandPolicy.ts)
    if (isCommandBlocked(args.command)) {
      return this.fail('Commande bloquée par politique de sécurité');
    }

    if (args.command.length > MAX_COMMAND_LEN) {
      return this.fail(`Commande trop longue (max ${MAX_COMMAND_LEN} chars)`);
    }

    const shell = args.shell;
    const timeoutMs = Math.min(args.timeoutMs, 120_000);
    const [program, flag] =
      shell === 'powershell' ? ['powershell.exe', '-Command'] : ['cmd.exe', '/C'];

    const started = Date.now();

    try {
      const { stdout, stderr } = await execFileAsync(program, [flag, args.command], {
        timeout: timeoutMs,
        cwd: args.workdir,
        env: {
          PATH: process.env['PATH'] ?? '',
          TEMP: process.env['TEMP'] ?? '',
          USERPROFILE: process.env['USERPROFILE'] ?? '',
        },
        maxBuffer: 5 * 1024 * 1024, // 5MB
      });

      return this.ok({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: 0,
        durationMs: Date.now() - started,
      });
    } catch (err) {
      const durationMs = Date.now() - started;
      // Forme d'erreur d'execFile : killed/stdout/stderr/code s'ajoutent à Error.
      const e = err as {
        killed?: boolean;
        stdout?: string;
        stderr?: string;
        code?: number | string;
        message?: string;
      };
      if (e.killed) {
        return this.fail(`Timeout après ${timeoutMs}ms`, { durationMs });
      }
      return this.ok({
        stdout: (e.stdout ?? '').trim(),
        stderr: (e.stderr ?? e.message ?? '').trim(),
        exitCode: e.code ?? -1,
        durationMs,
      });
    }
  }
}
