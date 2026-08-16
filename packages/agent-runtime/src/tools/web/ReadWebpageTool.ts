import { z } from 'zod';
import type { ToolResult } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { jsonSchemaFrom } from '../base/zodSchema';
import { extractArticleViaSidecar } from '../../lib/articleExtract';

/**
 * Comment le texte a été obtenu — remonté dans le résultat pour que la qualité
 * d'extraction soit observable au lieu d'être devinée.
 * `trafilatura` (sidecar) > `heuristique` (extractReadableText) > `brut`
 * (htmlToText, balises retirées seulement).
 */
export type ExtractionMethod = 'trafilatura' | 'heuristique' | 'selecteur' | 'brut';

const argsSchema = z.object({
  url: z.string().min(1).describe('URL to fetch and extract text from'),
  selector: z.string().optional().describe('CSS selector to extract specific element (optional)'),
  max_chars: z.number().default(20000).describe('Max characters of extracted text to return'),
});
type Args = z.infer<typeof argsSchema>;

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

// Minimal HTML-to-text extractor — removes tags, scripts, styles, decodes entities.
// Une ligne du résultat = un BLOC de la page (paragraphe, titre, cellule…), jamais
// une ligne du fichier source : les retours à la ligne du HTML source sont du
// pliage d'éditeur, pas de la structure. Les traiter comme des fins de ligne
// coupait les phrases en deux, et le filtre de prose aval (looksLikeProse) jetait
// le morceau sans ponctuation — d'où des extraits démarrant en cours de phrase.
export function htmlToText(html: string): string {
  // Sanctuarise les <pre> : LEURS retours à la ligne sont du contenu (code).
  const pres: string[] = [];
  const guarded = html.replace(/<pre\b[\s\S]*?<\/pre>/gi, m => {
    pres.push(m);
    return `\u0000${pres.length - 1}\u0000`;
  });
  const text = decodeHtmlEntities(
    guarded
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/[\r\n]+/g, ' ')
      .replace(
        /<\/?(?:br|p|div|li|ul|ol|h[1-6]|tr|td|th|table|section|article|blockquote|figure|figcaption|dt|dd)\b[^>]*>/gi,
        '\n',
      )
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  // eslint-disable-next-line no-control-regex -- sentinelle NUL volontaire (voir plus haut)
  return text.replace(/\u0000(\d+)\u0000/g, (_, i: string) =>
    decodeHtmlEntities(pres[Number(i)]?.replace(/<[^>]+>/g, '') ?? '').trim(),
  );
}

/**
 * Le texte ressemble-t-il à de la prose (phrases rédigées) plutôt qu'à un menu
 * de navigation, une table des matières ou une liste de liens ? Heuristique :
 * assez long, ponctuation de phrase, et une minorité de mots capitalisés (les
 * menus/sommaires sont massivement en Title Case). Pur, exporté pour tests.
 */
export function looksLikeProse(text: string, minLen = 80): boolean {
  const t = text.trim();
  if (t.length < minLen) return false;
  if (!/[.!?…]/.test(t)) return false;
  const words = t.split(/\s+/).filter(w => /\p{L}/u.test(w));
  if (words.length < 5) return false;
  const caps = words.filter(w => /^\p{Lu}/u.test(w)).length;
  return caps / words.length <= 0.4;
}

/**
 * Un texte qui démarre par une minuscule a été pris EN COURS de phrase (flux
 * RSS tronqué, fragment recollé) : à écarter quand on cite ou résume — un
 * extrait qui commence au milieu d'une phrase est illisible. Pur, exporté.
 */
export function startsMidSentence(text: string): boolean {
  return /^\p{Ll}/u.test(text.trim());
}

/**
 * Extrait le CONTENU d'une page d'article, pas la page entière : cible
 * `<article>`/`<main>` quand présent, retire header/nav/aside/footer, puis ne
 * garde que les lignes qui ressemblent à de la prose. Sans cela, les 1 500
 * premiers caractères d'un blog sont le titre du site + le menu ×2 + le
 * sommaire — et tout le pipeline de digest hérite de ce déchet. Renvoie ''
 * quand rien ne ressemble à un article (paywall, mur de cookies, accueil).
 */
export function extractReadableText(html: string): string {
  let scope = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|svg|iframe|template)\b[\s\S]*?<\/\1>/gi, '');
  const main =
    /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(scope) ??
    /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(scope) ??
    /<div[^>]+role=["']main["'][^>]*>([\s\S]*?)<\/div>/i.exec(scope);
  if (main?.[1]) scope = main[1];
  scope = scope.replace(/<(header|nav|aside|footer|form|button)\b[\s\S]*?<\/\1>/gi, '');

  return htmlToText(scope)
    .split('\n')
    .map(l => l.trim())
    .filter(l => looksLikeProse(l, 60))
    .join('\n');
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

async function fetchUrl(
  url: string,
  timeoutMs = 15_000,
): Promise<{ body: string; statusCode: number; contentType: string }> {
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
          Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9',
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
          if (total > 4_000_000) {
            req.destroy();
            reject(new Error('Réponse trop volumineuse (>4MB)'));
          }
        });
        res.on('end', () =>
          resolve({
            body: Buffer.concat(chunks).toString('utf-8'),
            statusCode: res.statusCode ?? 0,
            contentType: res.headers['content-type'] ?? '',
          }),
        );
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error('Timeout lors de la requête'));
    });
  });
}

export interface FetchedPage {
  body: string;
  statusCode: number;
  contentType: string;
}

/**
 * Dépendances injectables — uniquement pour les tests. La cascade d'extraction
 * (§3.3 de la veille 2026-08-16) est la partie la plus facile à casser sans s'en
 * apercevoir : elle ne se voit ni dans les types ni dans les fonctions pures.
 * Sans ces deux crochets, la tester exigerait un vrai réseau ET un vrai sidecar.
 */
export interface ReadWebpageDeps {
  fetchPage?: (url: string, timeoutMs?: number) => Promise<FetchedPage>;
  extractArticle?: (html: string, url?: string) => Promise<{ text: string } | null>;
}

export class ReadWebpageTool extends BaseTool<Args> {
  readonly name = 'read_webpage';
  readonly description =
    'Récupère une page web et en extrait le texte (HTTP simple, sans exécuter le JavaScript). Idéal pour doc, articles, README, issues GitHub. Si la page est une application JavaScript (SPA) ou renvoie peu de texte, utilise plutôt browser_navigate + browser_get_text.';
  readonly category = 'web' as const;
  readonly riskLevel = 'low' as const;
  readonly requiresConfirmation = false;
  override readonly argsSchema = argsSchema;
  readonly schema = jsonSchemaFrom(argsSchema);

  private readonly fetchPage: (url: string, timeoutMs?: number) => Promise<FetchedPage>;
  private readonly extractArticle: (html: string, url?: string) => Promise<{ text: string } | null>;

  constructor(deps: ReadWebpageDeps = {}) {
    super();
    this.fetchPage = deps.fetchPage ?? fetchUrl;
    this.extractArticle = deps.extractArticle ?? extractArticleViaSidecar;
  }

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
      ({ body, statusCode, contentType } = await this.fetchPage(url));
    } catch (err) {
      return this.fail(`Impossible de récupérer la page: ${String(err)}`);
    }

    if (statusCode >= 400) {
      return this.fail(`La page a répondu avec le code HTTP ${statusCode}`);
    }

    const isHtml = contentType.includes('html');
    let text: string;
    let method: ExtractionMethod = 'brut';

    if (isHtml && selector) {
      // Sélecteur explicite : l'appelant sait ce qu'il veut, on ne lui applique
      // pas en plus une détection d'article qui pourrait l'écarter.
      text = htmlToText(extractBySelector(body, selector) ?? body);
      method = 'selecteur';
    } else if (isHtml) {
      // Cascade du meilleur au plus permissif. Jusqu'ici, cet outil s'arrêtait
      // à `htmlToText` — donc menus, bandeaux cookies et « à lire aussi »
      // partaient au LLM jusqu'à max_chars, alors que le pipeline presse, lui,
      // débruitait déjà (cf. docs/veille/2026-08-16). Les deux chemins sont
      // désormais alignés. `htmlToText` reste en dernier recours pour ne jamais
      // rendre moins de texte qu'avant sur une page sans prose détectable.
      // try/catch et pas seulement `?? ` : le sidecar est une amélioration
      // optionnelle, jamais une dépendance dure. S'appuyer sur le fait que
      // extractArticleViaSidecar avale déjà ses erreurs marcherait, mais ferait
      // dépendre la robustesse de l'outil d'un détail interne de l'appelé.
      let viaSidecar: { text: string } | null = null;
      try {
        viaSidecar = await this.extractArticle(body, url);
      } catch {
        /* extraction indisponible → heuristique locale */
      }
      const readable = viaSidecar?.text ?? extractReadableText(body);
      if (readable.length > 0) {
        text = readable;
        method = viaSidecar !== null ? 'trafilatura' : 'heuristique';
      } else {
        text = htmlToText(body);
        method = 'brut';
      }
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
      extraction: method,
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
