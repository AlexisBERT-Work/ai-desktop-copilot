// Client HTTP minimal (node http/https) qui suit les redirections. Séparé de
// `runProcess` : c'est du réseau, pas du process, et il sert au pipeline presse
// comme aux outils web.

export async function httpGet(rawUrl: string, timeoutMs = 12_000, redirects = 3): Promise<string> {
  const url = new URL(rawUrl);
  const isHttps = url.protocol === 'https:';
  const { default: client } = await import(isHttps ? 'https' : 'http');

  return new Promise((resolve, reject) => {
    const req = (client as typeof import('https')).get(
      {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; CatDesk-Agent/1.0)',
          Accept:
            'application/json, application/rss+xml, application/atom+xml, text/xml;q=0.9, */*;q=0.8',
          'Accept-Language': 'fr,en;q=0.8',
        },
      },
      res => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location && redirects > 0) {
          req.destroy();
          const next = new URL(res.headers.location, url).toString();
          httpGet(next, timeoutMs, redirects - 1).then(resolve, reject);
          return;
        }
        if (status >= 400) {
          req.destroy();
          reject(new Error(`HTTP ${status}`));
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => {
          chunks.push(c);
          if (chunks.reduce((s, b) => s + b.length, 0) > 6_000_000) {
            req.destroy();
            reject(new Error('Réponse trop volumineuse'));
          }
        });
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
  });
}
