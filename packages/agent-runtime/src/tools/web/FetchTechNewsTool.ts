import { z } from 'zod';
import type { DailyCategory, ToolResult } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { jsonSchemaFrom } from '../base/zodSchema';

// ─── Types ────────────────────────────────────────────────────

export interface NewsItem {
  title: string;
  url: string;
  source: string;
  points?: number;
  comments?: number;
  publishedAt?: string; // ISO 8601
  excerpt?: string; // short plain-text teaser, used as input for summarization
  fullText?: string; // article body fetched from the page (enrichArticleTexts), capped
}

const argsSchema = z.object({
  sources: z
    .array(z.string())
    .optional()
    .describe(
      'Source ids to query (defaults to a balanced mix). Available: hackernews, devto, theverge, arstechnica, techcrunch, hackernoon, numerama, nextinpact, lesnumeriques',
    ),
  feeds: z
    .array(z.string())
    .optional()
    .describe(
      'Custom RSS/Atom feed URLs to include, e.g. ["https://blog.rust-lang.org/feed.xml"]. Added on top of (or instead of) the predefined sources',
    ),
  topics: z
    .array(z.string())
    .optional()
    .describe(
      'Keywords to filter by (matches title or excerpt), e.g. ["AI", "rust", "react"] (optional — no filter if omitted)',
    ),
  since_hours: z
    .number()
    .default(24)
    .describe('Only keep articles published within this many hours (0 = no limit)'),
  limit: z.number().default(15).describe('Max number of articles to return (1-50)'),
  lang: z
    .enum(['fr', 'en', 'all'])
    .default('all')
    .describe('Restrict predefined sources to a language (custom feeds are always included)'),
});
type Args = z.infer<typeof argsSchema>;

// ─── Source registry ──────────────────────────────────────────
// Toutes les sources sont gratuites et sans clé API. `kind` indique au
// fetcher comment parser la réponse (JSON spécifique vs flux RSS/Atom).

type SourceKind = 'hn' | 'devto' | 'feed';

interface SourceDef {
  id: string;
  label: string;
  lang: 'fr' | 'en';
  kind: SourceKind;
  url: string;
  /** Catégorie de daily attribuée aux articles de ce journal (filtrage client). */
  category: DailyCategory;
}

export const NEWS_SOURCES: Record<string, SourceDef> = {
  // ─── Tech ────────────────────────────────────────────────────
  hackernews: {
    id: 'hackernews',
    label: 'Hacker News',
    lang: 'en',
    kind: 'hn',
    url: 'https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=30',
    category: 'tech',
  },
  devto: {
    id: 'devto',
    label: 'DEV.to',
    lang: 'en',
    kind: 'devto',
    url: 'https://dev.to/api/articles?top=1&per_page=30',
    category: 'tech',
  },
  theverge: {
    id: 'theverge',
    label: 'The Verge',
    lang: 'en',
    kind: 'feed',
    url: 'https://www.theverge.com/rss/index.xml',
    category: 'tech',
  },
  arstechnica: {
    id: 'arstechnica',
    label: 'Ars Technica',
    lang: 'en',
    kind: 'feed',
    url: 'https://feeds.arstechnica.com/arstechnica/index',
    category: 'tech',
  },
  techcrunch: {
    id: 'techcrunch',
    label: 'TechCrunch',
    lang: 'en',
    kind: 'feed',
    url: 'https://techcrunch.com/feed/',
    category: 'tech',
  },
  hackernoon: {
    id: 'hackernoon',
    label: 'HackerNoon',
    lang: 'en',
    kind: 'feed',
    url: 'https://hackernoon.com/feed',
    category: 'tech',
  },
  numerama: {
    id: 'numerama',
    label: 'Numerama',
    lang: 'fr',
    kind: 'feed',
    url: 'https://www.numerama.com/feed/',
    category: 'tech',
  },
  nextinpact: {
    id: 'nextinpact',
    label: 'Next',
    lang: 'fr',
    kind: 'feed',
    url: 'https://next.ink/feed/',
    category: 'tech',
  },
  lesnumeriques: {
    id: 'lesnumeriques',
    label: 'Les Numériques',
    lang: 'fr',
    kind: 'feed',
    url: 'https://www.lesnumeriques.com/rss.xml',
    category: 'tech',
  },

  // ─── Finance / marchés ───────────────────────────────────────
  // (Les Échos retiré : flux en 403 systématique. La Tribune + Yahoo Finance OK.)
  latribune: {
    id: 'latribune',
    label: 'La Tribune',
    lang: 'fr',
    kind: 'feed',
    url: 'https://www.latribune.fr/feed.xml',
    category: 'markets',
  },
  yahoofinance: {
    id: 'yahoofinance',
    label: 'Yahoo Finance',
    lang: 'en',
    kind: 'feed',
    url: 'https://finance.yahoo.com/news/rssindex',
    category: 'markets',
  },
  investing: {
    id: 'investing',
    label: 'Investing.com',
    lang: 'en',
    kind: 'feed',
    url: 'https://www.investing.com/rss/news_25.rss',
    category: 'markets',
  },
  marketwatch: {
    id: 'marketwatch',
    label: 'MarketWatch',
    lang: 'en',
    kind: 'feed',
    url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories',
    category: 'markets',
  },
  ft: {
    id: 'ft',
    label: 'Financial Times',
    lang: 'en',
    kind: 'feed',
    url: 'https://www.ft.com/rss/home',
    category: 'markets',
  },
  cnbc: {
    id: 'cnbc',
    label: 'CNBC',
    lang: 'en',
    kind: 'feed',
    url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114',
    category: 'markets',
  },

  // ─── Macro / économie ────────────────────────────────────────
  lemonde_eco: {
    id: 'lemonde_eco',
    label: 'Le Monde — Économie',
    lang: 'fr',
    kind: 'feed',
    url: 'https://www.lemonde.fr/economie/rss_full.xml',
    category: 'macro',
  },

  // ─── Généraliste FR ──────────────────────────────────────────
  lemonde: {
    id: 'lemonde',
    label: 'Le Monde',
    lang: 'fr',
    kind: 'feed',
    url: 'https://www.lemonde.fr/rss/une.xml',
    category: 'misc',
  },
  lefigaro: {
    id: 'lefigaro',
    label: 'Le Figaro',
    lang: 'fr',
    kind: 'feed',
    url: 'https://www.lefigaro.fr/rss/figaro_actualites.xml',
    category: 'misc',
  },
  liberation: {
    id: 'liberation',
    label: 'Libération',
    lang: 'fr',
    kind: 'feed',
    url: 'https://www.liberation.fr/arc/outboundfeeds/rss/?outputType=xml',
    category: 'misc',
  },
  france24: {
    id: 'france24',
    label: 'France 24',
    lang: 'fr',
    kind: 'feed',
    url: 'https://www.france24.com/fr/rss',
    category: 'misc',
  },

  // ─── International (EN) ───────────────────────────────────────
  bbc: {
    id: 'bbc',
    label: 'BBC News',
    lang: 'en',
    kind: 'feed',
    url: 'https://feeds.bbci.co.uk/news/world/rss.xml',
    category: 'misc',
  },
  guardian: {
    id: 'guardian',
    label: 'The Guardian',
    lang: 'en',
    kind: 'feed',
    url: 'https://www.theguardian.com/world/rss',
    category: 'misc',
  },
  aljazeera: {
    id: 'aljazeera',
    label: 'Al Jazeera',
    lang: 'en',
    kind: 'feed',
    url: 'https://www.aljazeera.com/xml/rss/all.xml',
    category: 'misc',
  },
};

const DEFAULT_SOURCES = ['hackernews', 'theverge', 'techcrunch', 'devto'];

/** Catégorie d'un journal (par label de source). Repli 'misc' pour les flux custom. */
export function categoryForSourceLabel(label: string): DailyCategory {
  for (const def of Object.values(NEWS_SOURCES)) {
    if (def.label === label) return def.category;
  }
  return 'misc';
}

// ─── HTTP helper (node http/https, follows redirects) ─────────

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

// ─── Parsers (pure, exported for tests) ───────────────────────

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .trim();
}

function tagContent(block: string, tag: string): string | null {
  const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(block);
  return m ? decodeEntities(m[1]!) : null;
}

// Strip residual HTML from a feed description into a short plain-text teaser.
export function toExcerpt(raw: string, max = 500): string {
  const text = raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? text.slice(0, max).trimEnd() + '…' : text;
}

/** Parse an RSS 2.0 or Atom feed into news items. Resilient to formatting. */
export function parseFeed(xml: string, source: string): NewsItem[] {
  const items: NewsItem[] = [];

  // RSS <item> first, fall back to Atom <entry>.
  const blocks =
    xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? xml.match(/<entry\b[\s\S]*?<\/entry>/gi) ?? [];

  for (const block of blocks) {
    const title = tagContent(block, 'title');
    if (!title) continue;

    // RSS: <link>url</link> ; Atom: <link href="url" .../>
    let url = tagContent(block, 'link');
    if (!url) {
      const href = /<link[^>]*href=["']([^"']+)["']/i.exec(block);
      url = href ? decodeEntities(href[1]!) : null;
    }
    if (!url) continue;

    const dateRaw =
      tagContent(block, 'pubDate') ??
      tagContent(block, 'published') ??
      tagContent(block, 'updated') ??
      tagContent(block, 'dc:date');
    const ts = dateRaw ? Date.parse(dateRaw) : NaN;

    const descRaw =
      tagContent(block, 'description') ??
      tagContent(block, 'content:encoded') ??
      tagContent(block, 'summary') ??
      tagContent(block, 'content');
    const excerpt = descRaw ? toExcerpt(descRaw) : '';

    items.push({
      title,
      url,
      source,
      ...(Number.isNaN(ts) ? {} : { publishedAt: new Date(ts).toISOString() }),
      ...(excerpt.length > 0 ? { excerpt } : {}),
    });
  }

  return items;
}

function parseHackerNews(json: string): NewsItem[] {
  const data = JSON.parse(json) as { hits?: Array<Record<string, unknown>> };
  return (data.hits ?? [])
    .map((h): NewsItem | null => {
      const title = typeof h['title'] === 'string' ? h['title'] : null;
      if (!title) return null;
      const objectID = String(h['objectID'] ?? '');
      const url =
        typeof h['url'] === 'string' && h['url']
          ? h['url']
          : `https://news.ycombinator.com/item?id=${objectID}`;
      const created = typeof h['created_at'] === 'string' ? h['created_at'] : undefined;
      return {
        title,
        url,
        source: 'Hacker News',
        ...(typeof h['points'] === 'number' ? { points: h['points'] } : {}),
        ...(typeof h['num_comments'] === 'number' ? { comments: h['num_comments'] } : {}),
        ...(created ? { publishedAt: new Date(created).toISOString() } : {}),
      };
    })
    .filter((x): x is NewsItem => x !== null);
}

function parseDevto(json: string): NewsItem[] {
  const data = JSON.parse(json) as Array<Record<string, unknown>>;
  return (Array.isArray(data) ? data : [])
    .map((a): NewsItem | null => {
      const title = typeof a['title'] === 'string' ? a['title'] : null;
      const url = typeof a['url'] === 'string' ? a['url'] : null;
      if (!title || !url) return null;
      const published = typeof a['published_at'] === 'string' ? a['published_at'] : undefined;
      const desc = typeof a['description'] === 'string' ? a['description'].trim() : '';
      return {
        title,
        url,
        source: 'DEV.to',
        ...(typeof a['positive_reactions_count'] === 'number'
          ? { points: a['positive_reactions_count'] }
          : {}),
        ...(typeof a['comments_count'] === 'number' ? { comments: a['comments_count'] } : {}),
        ...(published ? { publishedAt: new Date(published).toISOString() } : {}),
        ...(desc.length > 0 ? { excerpt: toExcerpt(desc) } : {}),
      };
    })
    .filter((x): x is NewsItem => x !== null);
}

// ─── Aggregation helpers (pure, exported for tests) ───────────

function normalizeTitle(t: string): string {
  return t
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Drop duplicates by URL (host+path) or near-identical title, keeping the first. */
export function dedupeItems(items: NewsItem[]): NewsItem[] {
  const seenUrl = new Set<string>();
  const seenTitle = new Set<string>();
  const out: NewsItem[] = [];
  for (const item of items) {
    let urlKey = item.url;
    try {
      const u = new URL(item.url);
      urlKey = `${u.hostname}${u.pathname}`.replace(/\/$/, '');
    } catch {
      /* keep raw */
    }
    const titleKey = normalizeTitle(item.title);
    if (seenUrl.has(urlKey) || (titleKey.length > 0 && seenTitle.has(titleKey))) continue;
    seenUrl.add(urlKey);
    if (titleKey.length > 0) seenTitle.add(titleKey);
    out.push(item);
  }
  return out;
}

/** Keep items whose title OR excerpt matches any topic keyword (case-insensitive). */
export function filterByTopics(items: NewsItem[], topics: string[]): NewsItem[] {
  if (topics.length === 0) return items;
  const needles = topics.map(t => t.toLowerCase()).filter(t => t.length > 0);
  if (needles.length === 0) return items;
  return items.filter(i => {
    const hay = `${i.title}\n${i.excerpt ?? ''}`.toLowerCase();
    return needles.some(n => hay.includes(n));
  });
}

/**
 * Compile un motif regex tolérant : renvoie null (⇒ inactif) si le motif est
 * vide ou invalide, plutôt que de jeter. Insensible à la casse. Pur.
 */
export function safeRegex(pattern: string | null | undefined): RegExp | null {
  const p = (pattern ?? '').trim();
  if (p.length === 0) return null;
  try {
    return new RegExp(p, 'iu');
  } catch {
    return null;
  }
}

/**
 * Filtre regex par article (sur titre + extrait) :
 * - `include` : ne garde QUE les articles qui matchent (null = pas de contrainte) ;
 * - `exclude` : retire les articles qui matchent (null = aucune exclusion).
 * Un motif invalide est ignoré (traité comme null). Pur.
 */
export function filterByRegex(
  items: NewsItem[],
  include: string | null,
  exclude: string | null,
): NewsItem[] {
  const inc = safeRegex(include);
  const exc = safeRegex(exclude);
  if (inc === null && exc === null) return items;
  return items.filter(i => {
    const hay = `${i.title}\n${i.excerpt ?? ''}`;
    if (inc !== null && !inc.test(hay)) return false;
    if (exc !== null && exc.test(hay)) return false;
    return true;
  });
}

/** Derive a readable source label from a feed URL ("blog.rust-lang.org"). */
export function feedLabelFromUrl(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, '');
  } catch {
    return rawUrl;
  }
}

/** Keep items published within the window. Items without a date are kept. */
export function filterByAge(items: NewsItem[], sinceHours: number, now = Date.now()): NewsItem[] {
  if (sinceHours <= 0) return items;
  const cutoff = now - sinceHours * 60 * 60 * 1000;
  return items.filter(i => {
    if (!i.publishedAt) return true;
    const ts = Date.parse(i.publishedAt);
    return Number.isNaN(ts) || ts >= cutoff;
  });
}

/** Sort by score (points) desc, then by recency. */
export function rankItems(items: NewsItem[]): NewsItem[] {
  return [...items].sort((a, b) => {
    const pa = a.points ?? 0;
    const pb = b.points ?? 0;
    if (pb !== pa) return pb - pa;
    const ta = a.publishedAt ? Date.parse(a.publishedAt) : 0;
    const tb = b.publishedAt ? Date.parse(b.publishedAt) : 0;
    return tb - ta;
  });
}

// ─── Aggregation entry point (shared, reusable) ───────────────

export interface AggregateOptions {
  sources?: string[] | undefined;
  feeds?: string[] | undefined; // arbitrary RSS/Atom feed URLs chosen by the user
  topics?: string[] | undefined;
  /** Regex inclure/exclure (titre+extrait), appliquées AVANT classement et plafond. */
  includeRegex?: string | null | undefined;
  excludeRegex?: string | null | undefined;
  sinceHours?: number | undefined;
  limit?: number | undefined;
  lang?: 'fr' | 'en' | 'all' | undefined;
}

export interface AggregateResult {
  items: NewsItem[];
  sourceLabels: string[];
  failed: string[];
  totalFetched: number;
}

/**
 * Fetch, parse, dedupe, filter and rank news from the requested sources.
 * Throws only on an invalid source selection; a failing source is reported in
 * `failed` and never sinks the rest. Shared by FetchTechNewsTool and the
 * Discord digest tool.
 */
export async function aggregateNews(opts: AggregateOptions): Promise<AggregateResult> {
  const { sources, feeds, topics = [], sinceHours = 24, limit = 15, lang = 'all' } = opts;
  const includeRegex = opts.includeRegex ?? null;
  const excludeRegex = opts.excludeRegex ?? null;

  // Predefined sources. If the caller gave neither sources nor custom feeds,
  // fall back to the default mix; if they gave only custom feeds, skip defaults.
  const customFeeds = (Array.isArray(feeds) ? feeds : [])
    .map(f => f.trim())
    .filter(f => /^https?:\/\//i.test(f));

  let ids =
    Array.isArray(sources) && sources.length > 0
      ? sources
      : customFeeds.length > 0
        ? []
        : DEFAULT_SOURCES;
  ids = ids.filter(id => id in NEWS_SOURCES);
  if (lang !== 'all') ids = ids.filter(id => NEWS_SOURCES[id]!.lang === lang);

  if (ids.length === 0 && customFeeds.length === 0) {
    throw new Error(
      `Aucune source valide. Sources disponibles: ${Object.keys(NEWS_SOURCES).join(', ')}. Ou passe des URLs RSS/Atom via "feeds".`,
    );
  }

  // Unified fetch task list: predefined sources + custom feeds.
  const tasks: Array<{ label: string; run: () => Promise<NewsItem[]> }> = [
    ...ids.map(id => {
      const def = NEWS_SOURCES[id]!;
      return {
        label: def.label,
        run: async () => {
          const raw = await httpGet(def.url);
          if (def.kind === 'hn') return parseHackerNews(raw);
          if (def.kind === 'devto') return parseDevto(raw);
          return parseFeed(raw, def.label);
        },
      };
    }),
    ...customFeeds.map(url => {
      const label = feedLabelFromUrl(url);
      return { label, run: async () => parseFeed(await httpGet(url), label) };
    }),
  ];

  const results = await Promise.allSettled(tasks.map(t => t.run()));

  const collected: NewsItem[] = [];
  const failed: string[] = [];
  results.forEach((r, idx) => {
    if (r.status === 'fulfilled') collected.push(...r.value);
    else
      failed.push(
        `${tasks[idx]!.label}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`,
      );
  });

  // Plafond haut pour laisser de la marge aux digests volumineux (des centaines
  // d'articles à terme) ; la valeur usuelle reste bien plus basse via `limit`.
  // Les regex s'appliquent AVANT classement et plafond, sinon un thème pointu
  // serait évincé par le top du classement généraliste avant d'être filtré.
  const cappedLimit = Math.min(Math.max(1, limit ?? 15), 200);
  const items = rankItems(
    filterByAge(
      filterByRegex(
        filterByTopics(dedupeItems(collected), Array.isArray(topics) ? topics : []),
        includeRegex,
        excludeRegex,
      ),
      sinceHours ?? 24,
    ),
  ).slice(0, cappedLimit);

  return { items, sourceLabels: tasks.map(t => t.label), failed, totalFetched: collected.length };
}

// ─── Tool ─────────────────────────────────────────────────────

export class FetchTechNewsTool extends BaseTool<Args> {
  readonly name = 'fetch_tech_news';
  readonly description =
    'Agrège les actualités tech du jour depuis plusieurs sources gratuites (Hacker News, The Verge, TechCrunch, DEV.to, Ars Technica + sources FR : Numerama, Next, Les Numériques) et/ou des flux RSS/Atom personnalisés via `feeds`. Filtre par sujets (titre ou extrait) et fenêtre temporelle, déduplique et classe les articles. Le LLM rédige ensuite une synthèse + un résumé par article.';
  readonly category = 'web' as const;
  readonly riskLevel = 'low' as const;
  readonly requiresConfirmation = false;
  override readonly argsSchema = argsSchema;
  readonly schema = jsonSchemaFrom(argsSchema);

  async execute(args: Args): Promise<ToolResult> {
    const { sources, feeds, topics = [], since_hours = 24, limit = 15, lang = 'all' } = args;

    let result: AggregateResult;
    try {
      result = await aggregateNews({
        sources,
        feeds,
        topics,
        sinceHours: since_hours,
        limit,
        lang,
      });
    } catch (err) {
      return this.fail(err instanceof Error ? err.message : String(err));
    }

    if (result.totalFetched === 0) {
      return this.fail(
        `Impossible de récupérer des articles. ${result.failed.length > 0 ? `Erreurs: ${result.failed.join(' | ')}` : ''}`.trim(),
      );
    }

    return this.ok({
      generatedAt: new Date().toISOString(),
      sources: result.sourceLabels,
      ...(topics && topics.length > 0 ? { topics } : {}),
      sinceHours: since_hours,
      count: result.items.length,
      totalFetched: result.totalFetched,
      items: result.items,
      ...(result.failed.length > 0 ? { partialErrors: result.failed } : {}),
      note: "Brouillon de revue de presse. Le LLM doit produire, en français : (1) une SYNTHÈSE quotidienne de 2-4 phrases dégageant les tendances du jour, puis (2) pour CHAQUE article, un résumé d'une phrase basé sur son `excerpt` (titre + source + lien conservés).",
    });
  }
}
