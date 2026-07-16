import { z } from 'zod';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { ToolResult } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { jsonSchemaFrom } from '../base/zodSchema';

const exec = promisify(execFile);

const GH_API = 'https://api.github.com';

const argsSchema = z.object({
  repo: z.string().min(1).describe('GitHub repo in "owner/name" format (e.g. "alexis/catdesk")'),
  branch: z.string().optional().describe('Branch to watch (defaults to current git branch)'),
  token: z
    .string()
    .optional()
    .describe('GitHub personal access token (falls back to GITHUB_TOKEN env var)'),
  limit: z.number().default(5).describe('Number of recent workflow runs to fetch'),
});
type Args = z.infer<typeof argsSchema>;

interface WorkflowRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  branch: string;
  commit: string;
  commitMessage: string;
  startedAt: string;
  updatedAt: string;
  url: string;
  jobsFailed: FailedJob[];
}

interface FailedJob {
  name: string;
  conclusion: string;
  steps: FailedStep[];
}

interface FailedStep {
  name: string;
  conclusion: string;
  number: number;
}

// Minimal fetch using Node.js built-in (available in Node 18+)
async function ghFetch(path: string, token: string): Promise<unknown> {
  const { default: https } = await import('https');
  return new Promise((resolve, reject) => {
    const url = new URL(path.startsWith('http') ? path : `${GH_API}${path}`);
    const req = https.get(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'catdesk-agent/1.0',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
      res => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString()));
          } catch {
            reject(new Error('Invalid JSON from GitHub API'));
          }
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(10_000, () => {
      req.destroy();
      reject(new Error('GitHub API timeout'));
    });
  });
}

async function getCurrentBranch(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
    return stdout.trim();
  } catch {
    return null;
  }
}

async function getFailedJobs(repo: string, runId: number, token: string): Promise<FailedJob[]> {
  const data = (await ghFetch(`/repos/${repo}/actions/runs/${runId}/jobs`, token)) as {
    jobs?: Array<{
      name: string;
      conclusion: string | null;
      steps?: Array<{ name: string; conclusion: string | null; number: number }>;
    }>;
  };

  return (data.jobs ?? [])
    .filter(j => j.conclusion === 'failure' || j.conclusion === 'timed_out')
    .map(j => ({
      name: j.name,
      conclusion: j.conclusion ?? 'unknown',
      steps: (j.steps ?? [])
        .filter(s => s.conclusion === 'failure' || s.conclusion === 'timed_out')
        .map(s => ({ name: s.name, conclusion: s.conclusion ?? 'unknown', number: s.number })),
    }));
}

export class WatchCITool extends BaseTool<Args> {
  readonly name = 'watch_ci';
  readonly description =
    'Récupère les derniers runs GitHub Actions et remonte les erreurs de build sans quitter le terminal';
  readonly category = 'analysis' as const;
  readonly riskLevel = 'low' as const;
  readonly requiresConfirmation = false;
  override readonly argsSchema = argsSchema;
  readonly schema = jsonSchemaFrom(argsSchema);

  async execute(args: Args): Promise<ToolResult> {
    const { repo, branch, token: argToken, limit } = args;

    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
      return this.fail('Format repo invalide. Utilise "owner/nom-du-repo" (ex: "alexis/catdesk").');
    }

    const token = argToken ?? process.env['GITHUB_TOKEN'] ?? '';
    if (!token) {
      return this.fail(
        "Token GitHub manquant. Passe `token` en argument ou définis la variable d'environnement GITHUB_TOKEN.",
      );
    }

    const resolvedBranch = branch ?? (await getCurrentBranch(process.cwd())) ?? 'main';

    let runsData: {
      workflow_runs?: Array<{
        id: number;
        name: string;
        status: string;
        conclusion: string | null;
        head_branch: string;
        head_sha: string;
        head_commit?: { message?: string };
        run_started_at: string;
        updated_at: string;
        html_url: string;
      }>;
      message?: string;
    };

    try {
      runsData = (await ghFetch(
        `/repos/${repo}/actions/runs?branch=${encodeURIComponent(resolvedBranch)}&per_page=${limit}`,
        token,
      )) as typeof runsData;
    } catch (err) {
      return this.fail(`Impossible de contacter GitHub API: ${String(err)}`);
    }

    if (runsData.message) {
      return this.fail(`GitHub API: ${runsData.message}`);
    }

    const raw = runsData.workflow_runs ?? [];

    const runs: WorkflowRun[] = await Promise.all(
      raw.map(async r => {
        const jobsFailed =
          r.conclusion === 'failure' ? await getFailedJobs(repo, r.id, token).catch(() => []) : [];

        return {
          id: r.id,
          name: r.name,
          status: r.status,
          conclusion: r.conclusion,
          branch: r.head_branch,
          commit: r.head_sha.slice(0, 8),
          commitMessage: (r.head_commit?.message ?? '').split('\n')[0] ?? '',
          startedAt: r.run_started_at,
          updatedAt: r.updated_at,
          url: r.html_url,
          jobsFailed,
        };
      }),
    );

    const failing = runs.filter(r => r.conclusion === 'failure');
    const inProgress = runs.filter(r => r.status === 'in_progress' || r.status === 'queued');
    const passing = runs.filter(r => r.conclusion === 'success');

    return this.ok({
      repo,
      branch: resolvedBranch,
      summary: {
        total: runs.length,
        failing: failing.length,
        inProgress: inProgress.length,
        passing: passing.length,
      },
      failing,
      inProgress,
      passing,
      latestRun: runs[0] ?? null,
    });
  }
}
