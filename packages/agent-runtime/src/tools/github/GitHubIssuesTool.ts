import type { ToolResult } from '@neurodesk/shared-types';
import { TOOL_SCHEMAS } from '@neurodesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { ghFetch, resolveToken, validateRepo } from '../../lib/githubApi';

interface GitHubListIssuesArgs {
  repo: string;
  token?: string;
  state?: 'open' | 'closed' | 'all';
  labels?: string;
  search?: string;
  limit?: number;
}

interface RawIssue {
  number: number;
  title: string;
  state: string;
  body: string | null;
  html_url: string;
  created_at: string;
  updated_at: string;
  user: { login: string } | null;
  assignees: Array<{ login: string }>;
  labels: Array<{ name: string; color: string }>;
  comments: number;
  pull_request?: unknown;
}

interface RawSearchResult {
  total_count?: number;
  items?: RawIssue[];
  message?: string;
}

interface RawListResult {
  message?: string;
}

function formatIssue(issue: RawIssue) {
  const bodyPreview = issue.body
    ? issue.body.slice(0, 300).replace(/\r?\n/g, ' ').trim() + (issue.body.length > 300 ? '…' : '')
    : null;

  return {
    number: issue.number,
    title: issue.title,
    state: issue.state,
    author: issue.user?.login ?? 'unknown',
    labels: issue.labels.map(l => l.name),
    assignees: issue.assignees.map(a => a.login),
    comments: issue.comments,
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
    url: issue.html_url,
    ...(bodyPreview !== null ? { bodyPreview } : {}),
  };
}

export class GitHubIssuesTool extends BaseTool {
  readonly name = 'github_list_issues';
  readonly description = 'Liste ou recherche les issues GitHub d\'un dépôt. Supporte les filtres par état, labels et texte.';
  readonly category = 'github' as const;
  readonly riskLevel = 'low' as const;
  readonly requiresConfirmation = false;
  readonly schema = TOOL_SCHEMAS.github_list_issues;

  async execute(rawArgs: unknown): Promise<ToolResult> {
    const { repo, state = 'open', labels, search, limit = 20 } = rawArgs as GitHubListIssuesArgs;
    const token = resolveToken((rawArgs as GitHubListIssuesArgs).token);

    if (!repo) return this.fail('repo est requis');
    if (!validateRepo(repo)) return this.fail('Format repo invalide. Utilise "owner/nom-du-repo".');
    if (!token) return this.fail('Token GitHub manquant. Passe token en argument ou définis GITHUB_TOKEN.');

    let issues: RawIssue[];

    if (search) {
      // Use GitHub Search API for text search
      const q = [
        `is:issue`,
        `repo:${repo}`,
        state !== 'all' ? `is:${state}` : '',
        labels ? `label:"${labels}"` : '',
        search,
      ].filter(Boolean).join('+');

      let data: RawSearchResult;
      try {
        data = await ghFetch(`/search/issues?q=${encodeURIComponent(q)}&per_page=${Math.min(limit, 100)}`, token) as RawSearchResult;
      } catch (err) {
        return this.fail(`Impossible de contacter GitHub API: ${String(err)}`);
      }
      if (data.message) return this.fail(`GitHub API: ${data.message}`);
      issues = (data.items ?? []).filter(i => !i.pull_request);
    } else {
      // Standard list endpoint
      const params = new URLSearchParams({ state, per_page: String(Math.min(limit, 100)) });
      if (labels) params.set('labels', labels);

      let data: RawIssue[] | RawListResult;
      try {
        data = await ghFetch(`/repos/${repo}/issues?${params.toString()}`, token) as RawIssue[] | RawListResult;
      } catch (err) {
        return this.fail(`Impossible de contacter GitHub API: ${String(err)}`);
      }
      if (!Array.isArray(data)) {
        return this.fail(`GitHub API: ${(data as RawListResult).message ?? 'Réponse inattendue'}`);
      }
      // The list endpoint also returns PRs — filter them out
      issues = (data as RawIssue[]).filter(i => !i.pull_request);
    }

    return this.ok({
      repo,
      state,
      ...(search ? { search } : {}),
      ...(labels ? { labels } : {}),
      count: issues.length,
      issues: issues.slice(0, limit).map(formatIssue),
    });
  }
}
