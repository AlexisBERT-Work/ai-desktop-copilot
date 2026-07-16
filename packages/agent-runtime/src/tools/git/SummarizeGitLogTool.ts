import type { ToolResult } from '@catdesk/shared-types';
import { TOOL_SCHEMAS } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { runGit } from '../../lib/git';

interface SummarizeGitLogArgs {
  workdir?: string;
  since?: string;
  path?: string;
  author?: string;
  max?: number;
}

export interface Commit {
  hash: string;
  author: string;
  date: string;
  subject: string;
  type: string;
  scope: string | null;
}

const CONVENTIONAL = /^(\w+)(?:\(([^)]+)\))?(!)?:\s/;

export function classifyCommit(subject: string): { type: string; scope: string | null } {
  const m = subject.match(CONVENTIONAL);
  if (m === null) return { type: 'other', scope: null };
  return { type: (m[1] ?? 'other').toLowerCase(), scope: m[2] ?? null };
}

// Parse `git log` output produced with a unit-separator format.
export function parseLog(raw: string): Commit[] {
  const out: Commit[] = [];
  for (const line of raw.split('\n')) {
    if (line.trim().length === 0) continue;
    const [hash = '', author = '', date = '', subject = ''] = line.split('\x1f');
    const { type, scope } = classifyCommit(subject);
    out.push({ hash, author, date, subject, type, scope });
  }
  return out;
}

function tally(items: Array<string | null>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const it of items) {
    if (it === null) continue;
    counts[it] = (counts[it] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}

export class SummarizeGitLogTool extends BaseTool {
  readonly name = 'summarize_git_log';
  readonly description =
    "Résume l'historique git sur une fenêtre de temps, un chemin ou un auteur : répartition par type de commit (Conventional Commits), par auteur, fichiers les plus modifiés. Répond à « qu'a changé ce fichier cette semaine ? ».";
  readonly category = 'analysis' as const;
  readonly riskLevel = 'low' as const;
  readonly requiresConfirmation = false;
  readonly schema = TOOL_SCHEMAS.summarize_git_log;

  async execute(args: unknown): Promise<ToolResult> {
    const { workdir, since, path, author, max = 100 } = args as SummarizeGitLogArgs;
    const cwd = workdir ?? process.cwd();

    // hash \x1f author \x1f ISO date \x1f subject
    const logArgs = [
      'log',
      `--pretty=format:%h\x1f%an\x1f%ad\x1f%s`,
      '--date=short',
      `-n${Math.max(1, max)}`,
    ];
    if (typeof since === 'string' && since.length > 0) logArgs.push(`--since=${since}`);
    if (typeof author === 'string' && author.length > 0) logArgs.push(`--author=${author}`);
    if (typeof path === 'string' && path.length > 0) logArgs.push('--', path);

    try {
      const { stdout: logOut } = await runGit(logArgs, { cwd, maxBuffer: 2_000_000 });

      if (logOut.trim().length === 0) {
        return this.ok({ commitCount: 0, summary: 'Aucun commit ne correspond aux critères.' });
      }

      const commits = parseLog(logOut);

      // Most-changed files over the same range (best-effort; ignore if it fails).
      let topFiles: Array<{ file: string; changes: number }> = [];
      try {
        const statArgs = ['log', '--pretty=format:', '--name-only', `-n${Math.max(1, max)}`];
        if (typeof since === 'string' && since.length > 0) statArgs.push(`--since=${since}`);
        if (typeof author === 'string' && author.length > 0) statArgs.push(`--author=${author}`);
        if (typeof path === 'string' && path.length > 0) statArgs.push('--', path);
        const { stdout: filesOut } = await runGit(statArgs, { cwd, maxBuffer: 4_000_000 });
        const counts = tally(
          filesOut
            .split('\n')
            .map(l => l.trim())
            .filter(l => l.length > 0),
        );
        topFiles = Object.entries(counts)
          .slice(0, 10)
          .map(([file, changes]) => ({ file, changes }));
      } catch {
        // non-fatal
      }

      const byType = tally(commits.map(c => c.type));
      const byAuthor = tally(commits.map(c => c.author));
      const byScope = tally(commits.map(c => c.scope));

      return this.ok({
        scope: {
          ...(since !== undefined ? { since } : {}),
          ...(path !== undefined ? { path } : {}),
          ...(author !== undefined ? { author } : {}),
        },
        commitCount: commits.length,
        dateRange: {
          from: commits[commits.length - 1]?.date ?? null,
          to: commits[0]?.date ?? null,
        },
        byType,
        byAuthor,
        byScope,
        topFiles,
        commits: commits
          .slice(0, 50)
          .map(c => ({
            hash: c.hash,
            type: c.type,
            subject: c.subject,
            author: c.author,
            date: c.date,
          })),
        note: 'Données agrégées — le LLM doit en tirer un résumé narratif (thèmes principaux, points notables) à partir des subjects.',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('not a git repository'))
        return this.fail("Ce répertoire n'est pas un dépôt git.");
      return this.fail(`Erreur git: ${msg}`);
    }
  }
}
