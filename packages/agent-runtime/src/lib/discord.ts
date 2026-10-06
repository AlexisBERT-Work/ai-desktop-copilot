// Transport Discord : forme d'un embed + envoi vers un webhook. Volontairement
// ignorant du domaine presse — la construction des embeds vit dans
// news/discordEmbeds.ts.

export interface DiscordEmbed {
  title: string;
  url?: string;
  description?: string;
  color: number;
  footer?: { text: string };
  timestamp?: string;
}

export async function postToDiscord(
  url: string,
  payload: unknown,
): Promise<{ status: number; text: string }> {
  const { default: https } = await import('https');
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        method: 'POST',
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(Buffer.byteLength(body)),
          'User-Agent': 'catdesk-agent/1.0',
        },
      },
      res => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf-8') }),
        );
      },
    );
    req.on('error', reject);
    req.setTimeout(10_000, () => {
      req.destroy();
      reject(new Error('Webhook timeout'));
    });
    req.write(body);
    req.end();
  });
}
