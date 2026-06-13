const GH_API = 'https://api.github.com';

export function resolveToken(argToken?: string): string {
  return argToken ?? process.env['GITHUB_TOKEN'] ?? '';
}

export function validateRepo(repo: string): boolean {
  return /^[\w.-]+\/[\w.-]+$/.test(repo);
}

export async function ghFetch(path: string, token: string): Promise<unknown> {
  const { default: https } = await import('https');
  return new Promise((resolve, reject) => {
    const url = new URL(path.startsWith('http') ? path : `${GH_API}${path}`);
    const req = https.get(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'catdesk-agent/1.0',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
      res => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
          catch { reject(new Error('Invalid JSON from GitHub API')); }
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(10_000, () => { req.destroy(); reject(new Error('GitHub API timeout')); });
  });
}

// Fetch raw text (for diffs, patches)
export async function ghFetchText(path: string, token: string, accept: string): Promise<string> {
  const { default: https } = await import('https');
  return new Promise((resolve, reject) => {
    const url = new URL(path.startsWith('http') ? path : `${GH_API}${path}`);
    const req = https.get(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': accept,
          'User-Agent': 'catdesk-agent/1.0',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
      res => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      },
    );
    req.on('error', reject);
    req.setTimeout(15_000, () => { req.destroy(); reject(new Error('GitHub API timeout')); });
  });
}
