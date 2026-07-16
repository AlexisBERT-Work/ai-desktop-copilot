import type { ToolResult } from '@catdesk/shared-types';
import { TOOL_SCHEMAS } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { runGit } from '../../lib/git';

interface GitCommitArgs {
  workdir?: string;
  staged_only?: boolean;
}

// Conventional Commits type inference from diff content
export function inferCommitType(diff: string, stats: string): string {
  const lower = diff.toLowerCase() + stats.toLowerCase();

  if (/test|spec|\.test\.|\.spec\./.test(lower)) return 'test';
  if (/readme|\.md|docs?\/|documentation/.test(lower)) return 'docs';
  if (/package\.json|cargo\.toml|requirements\.txt|go\.mod/.test(lower) && /"version"/.test(lower))
    return 'chore';
  if (/refactor|rename|move|extract/.test(lower)) return 'refactor';
  if (/perf|performance|optim|faster|speed/.test(lower)) return 'perf';
  if (/style|format|lint|prettier|eslint/.test(lower)) return 'style';
  if (/\+.*fix|bug|error|crash|issue|broken/.test(lower)) return 'fix';
  return 'feat';
}

export function inferScope(files: string[]): string | null {
  if (files.length === 0) return null;

  // Group by top-level directory after packages/ or src/
  const dirs = files
    .map(f => {
      const m = f.match(/^(?:packages\/([^/]+)|apps\/([^/]+)|src\/([^/]+))/);
      return m?.[1] ?? m?.[2] ?? m?.[3] ?? null;
    })
    .filter((d): d is string => d !== null);

  if (dirs.length === 0) return null;

  const counts = new Map<string, number>();
  for (const d of dirs) counts.set(d, (counts.get(d) ?? 0) + 1);

  // Return the most common scope only if it covers >50% of changed files
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const top = sorted[0];
  if (top && top[1] / files.length > 0.5) return top[0];
  return null;
}

export class GitCommitTool extends BaseTool {
  readonly name = 'generate_commit_message';
  readonly description =
    'Lit le git diff stagé et génère un message de commit Conventional Commits';
  readonly category = 'analysis' as const;
  readonly riskLevel = 'low' as const;
  readonly requiresConfirmation = false;
  readonly schema = TOOL_SCHEMAS.generate_commit_message;

  async execute(args: unknown): Promise<ToolResult> {
    const { workdir, staged_only = true } = args as GitCommitArgs;
    const cwd = workdir ?? process.cwd();

    try {
      // Get diff
      const diffArgs = staged_only
        ? ['diff', '--staged', '--unified=3']
        : ['diff', 'HEAD', '--unified=3'];

      const [{ stdout: diff }, { stdout: statOut }, { stdout: logOut }] = await Promise.all([
        runGit(diffArgs, { cwd, maxBuffer: 500_000 }),
        runGit(['diff', '--staged', '--stat'], { cwd }),
        runGit(['log', '--oneline', '-5'], { cwd }),
      ]);

      if (diff.trim().length === 0) {
        return this.fail(
          staged_only
            ? 'Aucun changement stagé. Lance `git add` avant.'
            : 'Aucun changement détecté dans le working tree.',
        );
      }

      // Extract changed file paths from stat output
      const changedFiles = statOut
        .split('\n')
        .filter(l => l.includes('|'))
        .map(l => l.split('|')[0]?.trim() ?? '')
        .filter(Boolean);

      const type = inferCommitType(diff, statOut);
      const scope = inferScope(changedFiles);

      // Build a summary of what changed (first 10 files)
      const fileList = changedFiles.slice(0, 10).join(', ');
      const moreCount = changedFiles.length > 10 ? changedFiles.length - 10 : 0;

      return this.ok({
        suggestedType: type,
        suggestedScope: scope,
        // Template the user/LLM can fill in
        template: scope ? `${type}(${scope}): <description>` : `${type}: <description>`,
        changedFiles,
        fileSummary: moreCount > 0 ? `${fileList} (+${moreCount} autres)` : fileList,
        diffPreview: diff.slice(0, 3000),
        recentCommits: logOut.trim().split('\n').slice(0, 5),
        stagedOnly: staged_only,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('not a git repository')) {
        return this.fail("Ce répertoire n'est pas un dépôt git.");
      }
      return this.fail(`Erreur git: ${msg}`);
    }
  }
}
