import { runProcess, type RunProcessOptions } from './runProcess';

/** Exécute une commande git (voir runProcess pour les défauts sûrs). */
export function runGit(
  args: string[],
  opts: RunProcessOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  return runProcess('git', args, opts);
}
