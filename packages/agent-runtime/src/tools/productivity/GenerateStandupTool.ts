import { execFile } from 'child_process';
import { promisify } from 'util';
import type { ToolResult } from '@neurodesk/shared-types';
import { TOOL_SCHEMAS } from '@neurodesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { parseLog, type Commit } from '../git/SummarizeGitLogTool';

const exec = promisify(execFile);

interface GenerateStandupArgs {
  workdir?: string;
  since?: string;
  author?: string;
  blockers?: string;
}

// Turn commits into human standup bullets (pure, exported for tests).
export function commitsToBullets(commits: Commit[]): string[] {
  // De-duplicate by subject and drop noise (merges, wip).
  const seen = new Set<string>();
  const bullets: string[] = [];
  for (const c of commits) {
    const subject = c.subject.replace(/^(\w+)(\([^)]+\))?(!)?:\s*/, '').trim();
    if (subject.length === 0) continue;
    if (/^merge\b/i.test(c.subject)) continue;
    const key = subject.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const scope = c.scope ? `[${c.scope}] ` : '';
    bullets.push(`${scope}${subject}`);
  }
  return bullets;
}

export class GenerateStandupTool extends BaseTool {
  readonly name = 'generate_standup';
  readonly description =
    "Prépare un standup quotidien (hier / aujourd'hui / blocages) à partir de l'activité git récente. « Hier » = commits depuis `since`. Le LLM affine « aujourd'hui » à partir de la branche/des fichiers en cours.";
  readonly category = 'analysis' as const;
  readonly riskLevel = 'low' as const;
  readonly requiresConfirmation = false;
  readonly schema = TOOL_SCHEMAS.generate_standup;

  async execute(args: unknown): Promise<ToolResult> {
    const { workdir, since = '1 day ago', author, blockers } = args as GenerateStandupArgs;
    const cwd = workdir ?? process.cwd();

    try {
      // Resolve author: explicit arg, else the repo's configured user.
      let who = author;
      if (who === undefined) {
        try {
          const { stdout } = await exec('git', ['config', 'user.name'], { cwd });
          who = stdout.trim() || undefined;
        } catch { /* leave undefined → all authors */ }
      }

      const logArgs = ['log', `--since=${since}`, '--pretty=format:%h\x1f%an\x1f%ad\x1f%s', '--date=short'];
      if (who) logArgs.push(`--author=${who}`);
      const { stdout: logOut } = await exec('git', logArgs, { cwd, maxBuffer: 2_000_000 });

      const commits = logOut.trim().length > 0 ? parseLog(logOut) : [];
      const yesterday = commitsToBullets(commits);

      // Current branch + uncommitted files hint at "today".
      let branch = '';
      let inProgress: string[] = [];
      try {
        const { stdout: b } = await exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
        branch = b.trim();
        const { stdout: st } = await exec('git', ['status', '--porcelain'], { cwd });
        inProgress = st.split('\n').map((l) => l.slice(3).trim()).filter((l) => l.length > 0).slice(0, 10);
      } catch { /* non-fatal */ }

      return this.ok({
        since,
        ...(who ? { author: who } : {}),
        yesterday,
        today: {
          branch,
          uncommittedFiles: inProgress,
          hint: inProgress.length > 0
            ? 'Poursuivre le travail en cours sur les fichiers non commités ci-dessus.'
            : 'À préciser — pas de travail non commité détecté.',
        },
        blockers: typeof blockers === 'string' && blockers.length > 0 ? [blockers] : [],
        note:
          commits.length === 0
            ? `Aucun commit depuis "${since}". « Hier » est peut-être ailleurs (autre repo) ou hors fenêtre.`
            : 'Brouillon — le LLM doit formuler 3 points max par section, ton naturel.',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('not a git repository')) return this.fail('Ce répertoire n\'est pas un dépôt git.');
      return this.fail(`Erreur git: ${msg}`);
    }
  }
}
