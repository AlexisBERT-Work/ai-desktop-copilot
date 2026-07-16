import { z } from 'zod';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { ToolResult } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { jsonSchemaFrom } from '../base/zodSchema';

const exec = promisify(execFile);

const argsSchema = z.object({
  workdir: z.string().optional().describe('Git repo root (defaults to current directory)'),
  good: z.string().min(1).describe('Last known-good commit/ref (where the bug is absent)'),
  bad: z.string().default('HEAD').describe('Known-bad commit/ref (where the bug is present)'),
  path: z
    .string()
    .optional()
    .describe('Limit the suspect range to commits touching this file/dir (optional)'),
  test_command: z
    .string()
    .optional()
    .describe(
      'Command that exits 0 when good, non-zero when bad - enables a `git bisect run` one-liner (optional)',
    ),
});
type Args = z.infer<typeof argsSchema>;

export interface Candidate {
  hash: string;
  subject: string;
}

// `git bisect` halves the suspect set each step; worst case ≈ log2(n) tests.
export function stepsRemaining(n: number): number {
  if (n <= 0) return 0;
  return Math.ceil(Math.log2(n + 1));
}

// rev-list returns candidates newest-first; the midpoint is the commit bisect
// would check out next (closest to splitting the range in half).
export function pickMidpoint(candidates: Candidate[]): Candidate | null {
  if (candidates.length === 0) return null;
  const idx = Math.floor(candidates.length / 2);
  return candidates[idx] ?? candidates[candidates.length - 1] ?? null;
}

export class BisectGuidedTool extends BaseTool<Args> {
  readonly name = 'bisect_guided';
  readonly description =
    "Prépare un git bisect pour trouver le commit qui a cassé quelque chose : compte les commits suspects entre good et bad, désigne le prochain à tester (point milieu), estime le nombre d'étapes, et fournit les commandes manuelles + la ligne `git bisect run` si un test est donné. Lecture seule.";
  readonly category = 'analysis' as const;
  readonly riskLevel = 'low' as const;
  readonly requiresConfirmation = false;
  override readonly argsSchema = argsSchema;
  readonly schema = jsonSchemaFrom(argsSchema);

  async execute(args: Args): Promise<ToolResult> {
    const { workdir, good, bad, path, test_command } = args;
    const cwd = workdir ?? process.cwd();

    if (typeof good !== 'string' || good.trim().length === 0) {
      return this.fail('good (commit/ref de référence sain) est requis.');
    }

    // Suspect commits = those in (good, bad]. rev-list good..bad excludes `good`
    // itself, which is correct: good is known-good so it can't be the culprit.
    const revArgs = [
      'rev-list',
      '--first-parent',
      `${good}..${bad}`,
      '--pretty=format:%H\x1f%s',
      '--no-commit-header',
    ];
    if (typeof path === 'string' && path.length > 0) revArgs.push('--', path);

    try {
      const { stdout } = await exec('git', revArgs, { cwd, maxBuffer: 4_000_000 });

      const candidates: Candidate[] = stdout
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0)
        .map(l => {
          const [hash = '', subject = ''] = l.split('\x1f');
          return { hash: hash.slice(0, 12), subject };
        });

      if (candidates.length === 0) {
        return this.ok({
          suspectCount: 0,
          summary: `Aucun commit entre "${good}" et "${bad}"${path ? ` touchant ${path}` : ''}. Vérifie l'ordre (good doit être un ancêtre de bad) ou élargis la plage.`,
        });
      }

      const midpoint = pickMidpoint(candidates);
      const steps = stepsRemaining(candidates.length);

      const automated =
        typeof test_command === 'string' && test_command.length > 0
          ? `git bisect start ${bad} ${good}${path ? ` -- ${path}` : ''} && git bisect run ${test_command} ; git bisect reset`
          : null;

      return this.ok({
        good,
        bad,
        ...(path !== undefined ? { path } : {}),
        suspectCount: candidates.length,
        estimatedSteps: steps,
        nextToTest: midpoint,
        manualCommands: [
          `git bisect start ${bad} ${good}${path ? ` -- ${path}` : ''}`,
          '# git checks out the midpoint automatically — build/test it, then mark:',
          'git bisect good   # if the bug is ABSENT at this commit',
          'git bisect bad    # if the bug is PRESENT at this commit',
          '# repeat until git prints "<hash> is the first bad commit"',
          'git bisect reset  # when done, return to your branch',
        ],
        automatedCommand: automated,
        recentSuspects: candidates.slice(0, 15),
        note:
          automated === null
            ? `~${steps} tests à faire. Fournis test_command pour automatiser via "git bisect run".`
            : `~${steps} tests automatisés via la commande ci-dessus.`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('not a git repository'))
        return this.fail("Ce répertoire n'est pas un dépôt git.");
      if (/unknown revision|bad revision|ambiguous argument/i.test(msg)) {
        return this.fail(
          `Référence introuvable (good="${good}", bad="${bad}"). Vérifie les noms de commits/branches.`,
        );
      }
      return this.fail(`Erreur git: ${msg}`);
    }
  }
}
