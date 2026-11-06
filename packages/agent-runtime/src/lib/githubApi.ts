import { API_USER_AGENT, fetchJson, httpRequest } from './http';

const GH_API = 'https://api.github.com';

export function resolveToken(argToken?: string): string {
  return argToken ?? process.env['GITHUB_TOKEN'] ?? '';
}

export function validateRepo(repo: string): boolean {
  return /^[\w.-]+\/[\w.-]+$/.test(repo);
}

function ghUrl(path: string): string {
  return path.startsWith('http') ? path : `${GH_API}${path}`;
}

function ghHeaders(token: string, accept: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: accept,
    'User-Agent': API_USER_AGENT,
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

/** GET JSON sur l'API GitHub. Les erreurs d'API reviennent dans le JSON (`message`). */
export async function ghFetch(path: string, token: string): Promise<unknown> {
  return fetchJson(
    ghUrl(path),
    { headers: ghHeaders(token, 'application/vnd.github+json'), timeoutMs: 10_000 },
    'GitHub API',
  );
}

/** GET texte brut (diffs, patches) avec un `Accept` spécifique. */
export async function ghFetchText(path: string, token: string, accept: string): Promise<string> {
  const res = await httpRequest(ghUrl(path), {
    headers: ghHeaders(token, accept),
    timeoutMs: 15_000,
  });
  return res.text;
}
