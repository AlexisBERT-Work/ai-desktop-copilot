import { execFile } from 'child_process';
import { promisify } from 'util';
import type { ToolResult } from '@catdesk/shared-types';
import { TOOL_SCHEMAS } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';

const exec = promisify(execFile);

interface DockerPsArgs {
  all?: boolean;
  logs_for?: string;
  tail?: number;
}

export interface Container {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
  ports: string;
}

// Parse `docker ps --format '{{json .}}'` (one JSON object per line).
export function parseDockerPs(output: string): Container[] {
  const out: Container[] = [];
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      const o = JSON.parse(trimmed) as Record<string, string>;
      out.push({
        id: (o['ID'] ?? o['Id'] ?? '').slice(0, 12),
        name: o['Names'] ?? o['Name'] ?? '',
        image: o['Image'] ?? '',
        status: o['Status'] ?? '',
        state: o['State'] ?? '',
        ports: o['Ports'] ?? '',
      });
    } catch {
      // skip non-JSON lines
    }
  }
  return out;
}

function dockerMissing(msg: string): boolean {
  return /ENOENT|not recognized|introuvable|command not found|cannot find the file/i.test(msg);
}

export class DockerPsTool extends BaseTool {
  readonly name = 'docker_ps';
  readonly description =
    "Liste les conteneurs Docker (en cours, ou tous avec `all`) : nom, image, statut, ports. Donne `logs_for` pour récupérer aussi les dernières lignes de logs d'un conteneur. Lecture seule.";
  readonly category = 'system' as const;
  readonly riskLevel = 'low' as const;
  readonly requiresConfirmation = false;
  readonly schema = TOOL_SCHEMAS.docker_ps;

  async execute(args: unknown): Promise<ToolResult> {
    const { all = false, logs_for, tail = 50 } = args as DockerPsArgs;

    const psArgs = ['ps', '--format', '{{json .}}'];
    if (all) psArgs.push('-a');

    let containers: Container[];
    try {
      const { stdout } = await exec('docker', psArgs, { maxBuffer: 4_000_000, windowsHide: true });
      containers = parseDockerPs(stdout);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (dockerMissing(msg)) return this.fail('Docker introuvable. Vérifie que Docker Desktop est installé et démarré.');
      if (/cannot connect to the docker daemon|daemon/i.test(msg)) return this.fail('Le daemon Docker ne répond pas. Démarre Docker Desktop.');
      return this.fail(`Erreur docker ps: ${msg}`);
    }

    let logs: string | undefined;
    if (typeof logs_for === 'string' && logs_for.length > 0) {
      try {
        const { stdout, stderr } = await exec(
          'docker',
          ['logs', '--tail', String(Math.max(1, tail)), logs_for],
          { maxBuffer: 2_000_000, windowsHide: true },
        );
        // Docker writes app logs to both streams; merge.
        logs = (stdout + stderr).slice(-8000);
      } catch (err) {
        logs = `Logs indisponibles: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    return this.ok({
      count: containers.length,
      containers,
      ...(logs !== undefined ? { logs: { container: logs_for, tail, output: logs } } : {}),
    });
  }
}
