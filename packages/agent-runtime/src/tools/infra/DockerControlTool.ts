import { execFile } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';
import type { ToolResult } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { jsonSchemaFrom } from '../base/zodSchema';

const exec = promisify(execFile);

const argsSchema = z.object({
  action: z
    .enum(['start', 'stop', 'restart', 'up', 'down'])
    .describe('start/stop/restart a container, or compose up/down a project'),
  target: z
    .string()
    .optional()
    .describe(
      'Container name/id (start/stop/restart) or compose file path (up/down, defaults to ./docker-compose.yml)',
    ),
  workdir: z
    .string()
    .optional()
    .describe('Working directory for compose commands (defaults to current directory)'),
});
type Args = z.infer<typeof argsSchema>;

export type Action = Args['action'];

// Build the docker CLI argv for a given action (pure, exported for tests).
export function buildDockerArgs(
  action: Action,
  target: string | undefined,
): { ok: true; args: string[] } | { ok: false; error: string } {
  switch (action) {
    case 'start':
    case 'stop':
    case 'restart': {
      if (typeof target !== 'string' || target.trim().length === 0) {
        return { ok: false, error: `action "${action}" exige un conteneur cible (target).` };
      }
      return { ok: true, args: [action, target] };
    }
    case 'up': {
      const file = target && target.trim().length > 0 ? target : 'docker-compose.yml';
      return { ok: true, args: ['compose', '-f', file, 'up', '-d'] };
    }
    case 'down': {
      const file = target && target.trim().length > 0 ? target : 'docker-compose.yml';
      return { ok: true, args: ['compose', '-f', file, 'down'] };
    }
    default:
      return { ok: false, error: `action inconnue: ${String(action)}` };
  }
}

export class DockerControlTool extends BaseTool<Args> {
  readonly name = 'docker_control';
  readonly description =
    'Démarre/arrête/redémarre un conteneur Docker, ou fait un compose up/down sur un projet. Action avec effet de bord — confirmation requise. Pour up/down, `target` est le fichier compose (défaut docker-compose.yml).';
  readonly category = 'system' as const;
  readonly riskLevel = 'high' as const;
  readonly requiresConfirmation = true;
  override readonly argsSchema = argsSchema;
  readonly schema = jsonSchemaFrom(argsSchema);

  async execute({ action, target, workdir }: Args): Promise<ToolResult> {
    const built = buildDockerArgs(action, target);
    if (!built.ok) return this.fail(built.error);

    const opts = { maxBuffer: 4_000_000, windowsHide: true, ...(workdir ? { cwd: workdir } : {}) };
    try {
      const { stdout, stderr } = await exec('docker', built.args, opts);
      return this.ok({
        action,
        ...(target ? { target } : {}),
        command: `docker ${built.args.join(' ')}`,
        output: (stdout + stderr).trim().slice(-4000) || 'OK',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/ENOENT|not recognized|introuvable|command not found/i.test(msg)) {
        return this.fail('Docker introuvable. Vérifie que Docker Desktop est installé et démarré.');
      }
      if (/no such container|introuvable/i.test(msg)) {
        return this.fail(`Conteneur "${target}" introuvable. Liste-les avec docker_ps.`);
      }
      if (/cannot connect to the docker daemon|daemon/i.test(msg)) {
        return this.fail('Le daemon Docker ne répond pas. Démarre Docker Desktop.');
      }
      return this.fail(`Échec docker ${action}: ${msg}`);
    }
  }
}
