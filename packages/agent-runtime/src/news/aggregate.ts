import { httpGet } from '../lib/httpGet';
import type { NewsItem } from './newsItem';
import { parseDevto, parseFeed, parseHackerNews } from './parseFeed';
import { DEFAULT_SOURCES, NEWS_SOURCES, feedLabelFromUrl } from './sources';

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
