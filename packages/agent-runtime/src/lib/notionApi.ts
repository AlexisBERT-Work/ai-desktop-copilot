const NOTION_API = 'https://api.notion.com';
const NOTION_VERSION = '2022-06-28';

export function resolveNotionToken(argToken?: string): string {
  return argToken ?? process.env['NOTION_TOKEN'] ?? '';
}

export async function notionFetch(
  path: string,
  token: string,
  method: 'GET' | 'POST' = 'GET',
  body?: unknown,
): Promise<unknown> {
  const { default: https } = await import('https');
  const payload = body !== undefined ? JSON.stringify(body) : undefined;

  return new Promise((resolve, reject) => {
    const url = new URL(path.startsWith('http') ? path : `${NOTION_API}${path}`);
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'User-Agent': 'neurodesk-agent/1.0',
    };
    if (payload !== undefined) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(Buffer.byteLength(payload));
    }

    const req = https.request(
      {
        method,
        hostname: url.hostname,
        path: url.pathname + url.search,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
          catch { reject(new Error('Invalid JSON from Notion API')); }
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(12_000, () => { req.destroy(); reject(new Error('Notion API timeout')); });
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

interface RichText { plain_text?: string }

// Extract a human title from a Notion page/database object.
export function notionTitle(obj: Record<string, unknown>): string {
  // Databases have a top-level `title` array.
  const dbTitle = obj['title'];
  if (Array.isArray(dbTitle)) {
    return (dbTitle as RichText[]).map((t) => t.plain_text ?? '').join('').trim() || '(sans titre)';
  }
  // Pages keep the title under properties.<Name>.title
  const props = obj['properties'];
  if (props && typeof props === 'object') {
    for (const value of Object.values(props as Record<string, unknown>)) {
      if (value && typeof value === 'object' && (value as Record<string, unknown>)['type'] === 'title') {
        const arr = (value as Record<string, unknown>)['title'];
        if (Array.isArray(arr)) {
          const text = (arr as RichText[]).map((t) => t.plain_text ?? '').join('').trim();
          if (text) return text;
        }
      }
    }
  }
  return '(sans titre)';
}

// Flatten a block's rich_text into plain text.
export function blockToText(block: Record<string, unknown>): string {
  const type = block['type'] as string | undefined;
  if (type === undefined) return '';
  const inner = block[type];
  if (inner && typeof inner === 'object') {
    const rt = (inner as Record<string, unknown>)['rich_text'];
    if (Array.isArray(rt)) {
      return (rt as RichText[]).map((t) => t.plain_text ?? '').join('');
    }
  }
  return '';
}
