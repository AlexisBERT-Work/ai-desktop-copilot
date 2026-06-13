import type { ToolResult } from '@catdesk/shared-types';
import { TOOL_SCHEMAS } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';

interface ReadWebpageArgs {
  url: string;
  selector?: string;
  max_chars?: number;
}

// Minimal HTML-to-text extractor — removes tags, scripts, styles, decodes entities
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<(br|p|div|li|h[1-6]|tr|td|th)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

// Extract a named element from HTML (very naive CSS selector: tag, .class, #id)
export function extractBySelector(html: string, selector: string): string | null {
  // Support simple selectors: tag, #id, .class
  let pattern: RegExp | null = null;
  if (selector.startsWith('#')) {
    const id = selector.slice(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    pattern = new RegExp(`<[^>]+id=["']${id}["'][^>]*>([\\s\\S]*?)<\\/`, 'i');
  } else if (selector.startsWith('.')) {
    const cls = selector.slice(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    pattern = new RegExp(`<[^>]+class=["'][^"']*${cls}[^"']*["'][^>]*>([\\s\\S]*?)<\\/`, 'i');
  } else {
    const tag = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    pattern = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  }
  const m = pattern.exec(html);
  return m?.[1] ?? null;
}

async function fetchUrl(url: string, timeoutMs = 15_000): Promise<{ body: string; statusCode: number; contentType: string }> {
  const parsedUrl = new URL(url);
  const isHttps = parsedUrl.protocol === 'https:';
  const { default: transport } = await import(isHttps ? 'https' : 'http');

  return new Promise((resolve, reject) => {
    const req = (transport as typeof import('https')).get(
      {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; CatDesk-Agent/1.0)',
          'Accept': 'text/html,application/xhtml+xml,text/plain;q=0.9',
          'Accept-Language': 'fr,en;q=0.8',
        },
      },
      res => {
        // Follow one redirect
        if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
          req.destroy();
          fetchUrl(res.headers.location, timeoutMs).then(resolve, reject);
          return;
        }

        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => {
          chunks.push(c);
          // Abort if body exceeds 4MB to avoid memory bloat
          const total = chunks.reduce((s, b) => s + b.length, 0);
          if (total > 4_000_000) { req.destroy(); reject(new Error('Réponse trop volumineuse (>4MB)')); }
        });
        res.on('end', () => resolve({
          body: Buffer.concat(chunks).toString('utf-8'),
          statusCode: res.statusCode ?? 0,
          contentType: res.headers['content-type'] ?? '',
        }));
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('Timeout lors de la requête')); });
  });
}

export class ReadWebpageTool extends BaseTool {
  readonly name = 'read_webpage';
  readonly description = "Récupère une page web et en extrait le texte (HTTP simple, sans exécuter le JavaScript). Idéal pour doc, articles, README, issues GitHub. Si la page est une application JavaScript (SPA) ou renvoie peu de texte, utilise plutôt browser_navigate + browser_get_text.";
  readonly category = 'web' as const;
  readonly riskLevel = 'low' as const;
  readonly requiresConfirmation = false;
  readonly schema = TOOL_SCHEMAS.read_webpage;

  async execute(rawArgs: unknown): Promise<ToolResult> {
    const { url, selector, max_chars = 20_000 } = rawArgs as ReadWebpageArgs;

    if (!url?.trim()) return this.fail('url est requis');

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return this.fail(`URL invalide: ${url}`);
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return this.fail('Seuls les protocoles http et https sont supportés');
    }

    let body: string;
    let statusCode: number;
    let contentType: string;

    try {
      ({ body, statusCode, contentType } = await fetchUrl(url));
    } catch (err) {
      return this.fail(`Impossible de récupérer la page: ${String(err)}`);
    }

    if (statusCode >= 400) {
      return this.fail(`La page a répondu avec le code HTTP ${statusCode}`);
    }

    const isHtml = contentType.includes('html');
    let text: string;

    if (isHtml) {
      const source = selector ? (extractBySelector(body, selector) ?? body) : body;
      text = htmlToText(source);
    } else {
      // Plain text, JSON, etc.
      text = body.slice(0, max_chars * 4); // rough pre-trim before encoding overhead
    }

    const truncated = text.length > max_chars;
    const finalText = text.slice(0, max_chars);

    // Extract <title> for metadata
    const titleMatch = /<title[^>]*>([^<]+)<\/title>/i.exec(body);
    const title = titleMatch?.[1]?.trim() ?? null;

    // Heuristique SPA : page HTML volumineuse mais quasi sans texte extrait
    // => contenu rendu côté client (JavaScript). On oriente vers le navigateur.
    const likelySpa = isHtml && finalText.length < 300 && body.length > 3000;

    return this.ok({
      url,
      title,
      statusCode,
      contentType,
      text: finalText,
      charCount: finalText.length,
      truncated,
      ...(selector ? { selector } : {}),
      ...(likelySpa
        ? {
            likelySpa: true,
            hint: 'Page probablement rendue en JavaScript (SPA) : peu de texte extractible en HTTP simple. Réessaie avec browser_navigate (wait_until="networkidle") puis browser_get_text.',
          }
        : {}),
    });
  }
}
