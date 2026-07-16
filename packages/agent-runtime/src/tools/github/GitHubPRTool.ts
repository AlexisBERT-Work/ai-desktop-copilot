import { z } from 'zod';
import type { ToolResult } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { jsonSchemaFrom } from '../base/zodSchema';
import { ghFetch, ghFetchText, resolveToken, validateRepo } from '../../lib/githubApi';

const argsSchema = z.object({
  repo: z.string().min(1).describe('GitHub repo in "owner/name" format'),
  pr_number: z.number().describe('Pull request number'),
  token: z.string().optional().describe('GitHub PAT (falls back to GITHUB_TOKEN env var)'),
  include_diff: z.boolean().default(false).describe('Include the full unified diff (can be large)'),
  include_comments: z.boolean().default(true).describe('Include review comments and PR comments'),
});
type Args = z.infer<typeof argsSchema>;

interface RawPR {
  number: number;
  title: string;
  state: string;
  draft: boolean;
  merged: boolean;
  body: string | null;
  html_url: string;
  created_at: string;
  updated_at: string;
  merged_at: string | null;
  user: { login: string } | null;
  assignees: Array<{ login: string }>;
  requested_reviewers: Array<{ login: string }>;
  labels: Array<{ name: string }>;
  base: { ref: string; sha: string };
  head: { ref: string; sha: string };
  additions: number;
  deletions: number;
  changed_files: number;
  commits: number;
  comments: number;
  review_comments: number;
  mergeable: boolean | null;
  mergeable_state: string;
  message?: string;
}

interface RawFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
}

interface RawComment {
  user: { login: string } | null;
  body: string;
  created_at: string;
  html_url: string;
}

interface RawReview {
  user: { login: string } | null;
  state: string;
  body: string;
  submitted_at: string;
}

export class GitHubPRTool extends BaseTool<Args> {
  readonly name = 'github_get_pr';
  readonly description =
    "Récupère les détails complets d'une pull request GitHub : description, fichiers modifiés, commentaires, statut de review, et optionnellement le diff complet.";
  readonly category = 'github' as const;
  readonly riskLevel = 'low' as const;
  readonly requiresConfirmation = false;
  override readonly argsSchema = argsSchema;
  readonly schema = jsonSchemaFrom(argsSchema);

  async execute(rawArgs: Args): Promise<ToolResult> {
    const { repo, pr_number, include_diff, include_comments } = rawArgs;
    const token = resolveToken(rawArgs.token);

    if (!repo) return this.fail('repo est requis');
    if (!pr_number) return this.fail('pr_number est requis');
    if (!validateRepo(repo)) return this.fail('Format repo invalide. Utilise "owner/nom-du-repo".');
    if (!token)
      return this.fail('Token GitHub manquant. Passe token en argument ou définis GITHUB_TOKEN.');

    // Fetch PR, files (and optionally comments + reviews) in parallel
    let pr: RawPR;
    let files: RawFile[];
    let comments: RawComment[] = [];
    let reviews: RawReview[] = [];
    let diff: string | null = null;

    try {
      const prBase = `/repos/${repo}/pulls/${pr_number}`;

      const fetches: Promise<unknown>[] = [
        ghFetch(prBase, token),
        ghFetch(`${prBase}/files?per_page=100`, token),
      ];

      if (include_comments) {
        fetches.push(
          ghFetch(`/repos/${repo}/issues/${pr_number}/comments?per_page=50`, token),
          ghFetch(`${prBase}/reviews?per_page=50`, token),
        );
      }

      if (include_diff) {
        fetches.push(ghFetchText(prBase, token, 'application/vnd.github.diff'));
      }

      const results = await Promise.all(fetches);
      pr = results[0] as RawPR;
      files = results[1] as RawFile[];

      if (include_comments) {
        comments = (results[2] ?? []) as RawComment[];
        reviews = (results[3] ?? []) as RawReview[];
      }

      if (include_diff) {
        diff = results[include_comments ? 4 : 2] as string;
      }
    } catch (err) {
      return this.fail(`Impossible de contacter GitHub API: ${String(err)}`);
    }

    if (pr.message) return this.fail(`GitHub API: ${pr.message}`);

    const formattedFiles = files.map(f => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      changes: f.changes,
      ...(f.patch && !include_diff
        ? { patchPreview: f.patch.slice(0, 400) + (f.patch.length > 400 ? '…' : '') }
        : {}),
    }));

    const formattedComments = comments.map(c => ({
      author: c.user?.login ?? 'unknown',
      body: c.body.slice(0, 500) + (c.body.length > 500 ? '…' : ''),
      createdAt: c.created_at,
      url: c.html_url,
    }));

    const formattedReviews = reviews
      .filter(r => r.state !== 'COMMENTED' || r.body)
      .map(r => ({
        author: r.user?.login ?? 'unknown',
        state: r.state,
        ...(r.body ? { body: r.body.slice(0, 300) + (r.body.length > 300 ? '…' : '') } : {}),
        submittedAt: r.submitted_at,
      }));

    const reviewSummary = reviews.reduce<Record<string, number>>((acc, r) => {
      acc[r.state] = (acc[r.state] ?? 0) + 1;
      return acc;
    }, {});

    return this.ok({
      repo,
      number: pr.number,
      title: pr.title,
      state: pr.merged ? 'merged' : pr.state,
      draft: pr.draft,
      author: pr.user?.login ?? 'unknown',
      base: pr.base.ref,
      head: pr.head.ref,
      labels: pr.labels.map(l => l.name),
      assignees: pr.assignees.map(a => a.login),
      requestedReviewers: pr.requested_reviewers.map(r => r.login),
      stats: {
        commits: pr.commits,
        additions: pr.additions,
        deletions: pr.deletions,
        changedFiles: pr.changed_files,
        comments: pr.comments,
        reviewComments: pr.review_comments,
      },
      mergeability: {
        mergeable: pr.mergeable,
        state: pr.mergeable_state,
      },
      reviewSummary,
      description: pr.body,
      createdAt: pr.created_at,
      updatedAt: pr.updated_at,
      ...(pr.merged_at ? { mergedAt: pr.merged_at } : {}),
      url: pr.html_url,
      files: formattedFiles,
      ...(include_comments ? { comments: formattedComments, reviews: formattedReviews } : {}),
      ...(diff !== null
        ? { diff: diff.slice(0, 50_000) + (diff.length > 50_000 ? '\n… (diff truncated)' : '') }
        : {}),
    });
  }
}
