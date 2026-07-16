import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface RunProcessOptions {
  cwd?: string;
  timeoutMs?: number;
  maxBuffer?: number;
}

/**
 * execFile promisifié avec des défauts sûrs : timeout, buffer borné, pas de
 * fenêtre console sur Windows. Helper partagé — les outils git/docker ne
 * doivent plus réimplémenter leur propre wrapper child_process.
 */
export async function runProcess(
  program: string,
  args: string[],
  opts: RunProcessOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  const { cwd, timeoutMs = 30_000, maxBuffer = 4_000_000 } = opts;
  const { stdout, stderr } = await execFileAsync(program, args, {
    ...(cwd !== undefined ? { cwd } : {}),
    timeout: timeoutMs,
    maxBuffer,
    windowsHide: true,
  });
  return { stdout, stderr };
}
