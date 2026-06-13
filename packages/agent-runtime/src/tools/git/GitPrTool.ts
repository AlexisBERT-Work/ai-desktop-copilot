import { execFile } from 'child_process';
import { promisify } from 'util';
import type { ToolResult } from '@catdesk/shared-types';
import { TOOL_SCHEMAS } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';

const exec = promisify(execFile);

interface GitPrArgs {
  workdir?: string;
  base_branch?: string;
}

interface CommitInfo {
  hash: string;
  subject: string;
  author: string;
  date: string;
}

async function getCurrentBranch(cwd: string): Promise<string> {
  const { stdout } = await exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
  return stdout.trim();
}

async function getCommitsSince(cwd: string, base: string): Promise<CommitInfo[]> {
  const { stdout } = await exec(
    'git',
    ['log', `${base}..HEAD`, '--format=%H|%s|%an|%ad', '--date=short'],
    { cwd }
  );
  return stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const parts = line.split('|');
      return {
        hash: parts[0]?.slice(0, 8) ?? '',
        subject: parts[1] ?? '',
        author: parts[2] ?? '',
        date: parts[3] ?? '',
      };
    });
}

// Derive a PR title from the commit list using Conventional Commits
function derivePrTitle(commits: CommitInfo[], branch: string): string {
  if (commits.length === 1 && commits[0] !== undefined) {
    return commits[0].subject;
  }

  // Use branch name as fallback title signal
  const branchTitle = branch
    .replace(/^(feat|fix|chore|refactor|docs|test)\//, '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());

  // Find dominant commit type
  const types = commits.map(c => c.subject.match(/^(\w+)[\(:]/) ? c.subject.match(/^(\w+)[\(:]/)?.[1] : null).filter(Boolean);
  const typeCounts = new Map<string, number>();
  for (const t of types) {
    if (t) typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
  }
  const dominantType = [...typeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  return dominantType ? `${dominantType}: ${branchTitle}` : branchTitle;
}

export class GitPrTool extends BaseTool {
  readonly name = 'generate_pr_description';
  readonly description = 'Génère un titre et une description de PR à partir des commits et du diff par rapport à la branche de base';
  readonly category = 'analysis' as const;
  readonly riskLevel = 'low' as const;
  readonly requiresConfirmation = false;
  readonly schema = TOOL_SCHEMAS.generate_pr_description;

  async execute(args: unknown): Promise<ToolResult> {
    const { workdir, base_branch = 'main' } = args as GitPrArgs;
    const cwd = workdir ?? process.cwd();

    try {
      const [currentBranch, commits] = await Promise.all([
        getCurrentBranch(cwd),
        getCommitsSince(cwd, base_branch),
      ]);

      if (commits.length === 0) {
        return this.fail(`Aucun commit entre ${base_branch} et HEAD. Vérifie la branche de base.`);
      }

      // Diff stat for changed files
      const { stdout: statOut } = await exec(
        'git',
        ['diff', `${base_branch}...HEAD`, '--stat'],
        { cwd, maxBuffer: 200_000 }
      );

      const changedFiles = statOut
        .split('\n')
        .filter(l => l.includes('|'))
        .map(l => l.split('|')[0]?.trim() ?? '')
        .filter(Boolean);

      const title = derivePrTitle(commits, currentBranch);

      // Categorize commits for the description
      const breaking = commits.filter(c => c.subject.includes('!')).map(c => c.subject);
      const features = commits.filter(c => /^feat[\(:!]/.test(c.subject)).map(c => c.subject);
      const fixes = commits.filter(c => /^fix[\(:!]/.test(c.subject)).map(c => c.subject);
      const others = commits
        .filter(c => !breaking.includes(c.subject) && !features.includes(c.subject) && !fixes.includes(c.subject))
        .map(c => c.subject);

      return this.ok({
        suggestedTitle: title,
        currentBranch,
        baseBranch: base_branch,
        commits,
        changedFiles,
        totalCommits: commits.length,
        sections: {
          breaking: breaking.length > 0 ? breaking : null,
          features: features.length > 0 ? features : null,
          fixes: fixes.length > 0 ? fixes : null,
          others: others.length > 0 ? others : null,
        },
        diffStat: statOut.slice(0, 1000),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('not a git repository')) {
        return this.fail('Ce répertoire n\'est pas un dépôt git.');
      }
      if (msg.includes('unknown revision')) {
        return this.fail(`Branche de base "${base_branch}" introuvable. Essaie avec "master" ou le nom exact.`);
      }
      return this.fail(`Erreur git: ${msg}`);
    }
  }
}
