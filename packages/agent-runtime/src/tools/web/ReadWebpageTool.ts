import { z } from 'zod';
import type { ToolResult } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { jsonSchemaFrom } from '../base/zodSchema';
import { extractBySelector, htmlToText } from '../../lib/readableText';
import { BROWSER_USER_AGENT, httpRequest } from '../../lib/http';

const argsSchema = z.object({
  url: z.string().min(1).describe('URL to fetch and extract text from'),
  selector: z.string().optional().describe('CSS selector to extract specific element (optional)'),
  max_chars: z.number().default(20000).describe('Max characters of extracted text to return'),
});
type Args = z.infer<typeof argsSchema>;

export class ReadWebpageTool extends BaseTool<Args> {
  readonly name = 'read_webpage';
  readonly description =
    'Récupère une page web et en extrait le texte (HTTP simple, sans exécuter le JavaScript). Idéal pour doc, articles, README, issues GitHub. Si la page est une application JavaScript (SPA) ou renvoie peu de texte, utilise plutôt browser_navigate + browser_get_text.';
  readonly category = 'web' as const;
  readonly riskLevel = 'low' as const;
  readonly requiresConfirmation = false;
  override readonly argsSchema = argsSchema;
  readonly schema = jsonSchemaFrom(argsSchema);

  async execute(rawArgs: Args): Promise<ToolResult> {
    const { url, selector, max_chars = 20_000 } = rawArgs;

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
      const res = await httpRequest(url, {
        timeoutMs: 15_000,
        maxBytes: 4_000_000,
        headers: {
          'User-Agent': BROWSER_USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9',
          'Accept-Language': 'fr,en;q=0.8',
        },
      });
      body = res.text;
      statusCode = res.status;
      contentType = res.headers.get('content-type') ?? '';
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
