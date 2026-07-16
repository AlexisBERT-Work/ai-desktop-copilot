import { execFile } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';
import type { ToolResult } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { jsonSchemaFrom } from '../base/zodSchema';

const exec = promisify(execFile);

const argsSchema = z.object({
  port: z
    .number()
    .int()
    .optional()
    .describe('TCP port to inspect (optional — lists all listening ports if omitted)'),
});
type Args = z.infer<typeof argsSchema>;

export interface Listener {
  proto: string;
  localAddress: string;
  port: number;
  pid: number;
  state: string;
}

// Parse Windows `netstat -ano` output, keeping LISTENING TCP rows.
export function parseNetstat(output: string, filterPort?: number): Listener[] {
  const out: Listener[] = [];
  const seen = new Set<string>();
  for (const line of output.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 4) continue;
    const proto = parts[0] ?? '';
    if (proto !== 'TCP') continue; // only TCP listeners

    const local = parts[1] ?? '';
    // TCP rows: Proto Local Foreign State PID
    const state = parts[3] ?? '';
    const pid = parseInt(parts[4] ?? '', 10);
    if (Number.isNaN(pid)) continue;
    if (state !== 'LISTENING') continue;

    // local is like 0.0.0.0:3000 or [::]:3000
    const m = local.match(/^(.*):(\d+)$/);
    if (m === null) continue;
    const port = parseInt(m[2] ?? '', 10);
    if (Number.isNaN(port)) continue;
    if (filterPort !== undefined && port !== filterPort) continue;

    const key = `${proto}:${port}:${pid}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ proto, localAddress: m[1] ?? '', port, pid, state: state || 'LISTENING' });
  }
  return out;
}

// Parse `tasklist /fo csv /nh` into a pid→name map.
export function parseTasklist(output: string): Map<number, string> {
  const map = new Map<number, string>();
  for (const line of output.split('\n')) {
    const cols = line.match(/"([^"]*)"/g);
    if (cols === null || cols.length < 2) continue;
    const name = cols[0]?.replace(/"/g, '') ?? '';
    const pid = parseInt(cols[1]?.replace(/"/g, '') ?? '', 10);
    if (!Number.isNaN(pid)) map.set(pid, name);
  }
  return map;
}

export class InspectPortTool extends BaseTool<Args> {
  readonly name = 'inspect_port';
  readonly description =
    'Liste les ports TCP en écoute et les processus associés (« qui tourne sur le port 3000 ? »). Donne `port` pour cibler un port, sinon liste tout. Lecture seule — utilise kill_process pour libérer un port.';
  readonly category = 'system' as const;
  readonly riskLevel = 'low' as const;
  readonly requiresConfirmation = false;
  override readonly argsSchema = argsSchema;
  readonly schema = jsonSchemaFrom(argsSchema);

  async execute({ port }: Args): Promise<ToolResult> {
    let netstatOut: string;
    try {
      const { stdout } = await exec('netstat', ['-ano'], {
        maxBuffer: 4_000_000,
        windowsHide: true,
      });
      netstatOut = stdout;
    } catch (err) {
      return this.fail(
        `Impossible d'exécuter netstat: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const listeners = parseNetstat(netstatOut, port);

    // Resolve process names for the PIDs we found (best-effort).
    let names = new Map<number, string>();
    if (listeners.length > 0) {
      try {
        const { stdout } = await exec('tasklist', ['/fo', 'csv', '/nh'], {
          maxBuffer: 8_000_000,
          windowsHide: true,
        });
        names = parseTasklist(stdout);
      } catch {
        // names stay empty
      }
    }

    const result = listeners.map(l => ({ ...l, process: names.get(l.pid) ?? null }));

    return this.ok({
      ...(port !== undefined ? { port } : {}),
      count: result.length,
      listeners: result,
      summary:
        port !== undefined
          ? result.length === 0
            ? `Aucun processus en écoute sur le port ${port}.`
            : `Port ${port} : ${result.map(r => `${r.process ?? 'pid ' + r.pid} (pid ${r.pid})`).join(', ')}.`
          : `${result.length} port(s) TCP en écoute.`,
    });
  }
}
