import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface RunProcessOptions {
  cwd?: string;
  /** Délai au-delà duquel l'enfant est tué (défaut 30 s). */
  timeoutMs?: number;
  /** Plafond de sortie capturée (défaut 4 Mo). */
  maxBuffer?: number;
  /**
   * Environnement de l'enfant. REMPLACE l'environnement hérité (il n'est pas
   * fusionné) : c'est ce qui permet à run_command de ne transmettre qu'une
   * liste blanche de variables.
   */
  env?: NodeJS.ProcessEnv;
}

/**
 * execFile promisifié avec des défauts sûrs : timeout, buffer borné, et surtout
 * `windowsHide: true` — sans lui, chaque appel fait clignoter une fenêtre de
 * console sur Windows.
 *
 * Helper partagé : les outils git/docker/système ne doivent pas réimplémenter
 * leur propre wrapper `promisify(execFile)`, sinon ils reperdent ces défauts
 * un par un (c'est exactement ce qui était arrivé à 13 d'entre eux).
 *
 * Les erreurs ne sont PAS avalées : en cas d'échec, `execFile` rejette avec une
 * Error enrichie de `killed`/`code`/`stdout`/`stderr`, que l'appelant peut
 * inspecter (voir RunCommandTool).
 */
export async function runProcess(
  program: string,
  args: string[],
  opts: RunProcessOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  const { cwd, timeoutMs = 30_000, maxBuffer = 4_000_000, env } = opts;
  const { stdout, stderr } = await execFileAsync(program, args, {
    ...(cwd !== undefined ? { cwd } : {}),
    ...(env !== undefined ? { env } : {}),
    timeout: timeoutMs,
    maxBuffer,
    windowsHide: true,
  });
  return { stdout, stderr };
}
