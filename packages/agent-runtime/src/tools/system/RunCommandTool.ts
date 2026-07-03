import { execFile } from 'child_process';
import { promisify } from 'util';
import type { ToolResult } from '@catdesk/shared-types';
import { TOOL_SCHEMAS } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { isCommandBlocked, MAX_COMMAND_LEN } from '../../security/commandPolicy';

const execFileAsync = promisify(execFile);

interface Args {
  command: string;
  shell?: 'powershell' | 'cmd';
  workdir?: string;
  timeoutMs?: number;
}

export class RunCommandTool extends BaseTool {
  name = 'run_command';
  description = 'Exécute une commande PowerShell ou CMD. ATTENTION: demande confirmation avant exécution.';
  category = 'system' as const;
  riskLevel = 'high' as const;
  requiresConfirmation = true;
  schema = TOOL_SCHEMAS.run_command;

  async execute(rawArgs: unknown): Promise<ToolResult> {
    const args = rawArgs as Args;
    if (!args.command) return this.fail('command est requis');

    // Safety check (politique partagée — voir security/commandPolicy.ts)
    if (isCommandBlocked(args.command)) {
      return this.fail('Commande bloquée par politique de sécurité');
    }

    if (args.command.length > MAX_COMMAND_LEN) {
      return this.fail(`Commande trop longue (max ${MAX_COMMAND_LEN} chars)`);
    }

    const shell = args.shell ?? 'powershell';
    const timeoutMs = Math.min(args.timeoutMs ?? 30_000, 120_000);
    const [program, flag] = shell === 'powershell'
      ? ['powershell.exe', '-Command']
      : ['cmd.exe', '/C'];

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
    } catch (err: any) {
      const durationMs = Date.now() - started;
      if (err.killed) {
        return this.fail(`Timeout après ${timeoutMs}ms`, { durationMs });
      }
      return this.ok({
        stdout: (err.stdout ?? '').trim(),
        stderr: (err.stderr ?? err.message ?? '').trim(),
        exitCode: err.code ?? -1,
        durationMs,
      });
    }
  }
}
