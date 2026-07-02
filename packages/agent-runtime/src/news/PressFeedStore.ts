import type { DailyCategory, PressFeed } from '@catdesk/shared-types';
import { isDailyCategory } from '@catdesk/shared-types';
import { signIn, type SupabaseAdminConfig } from './SupabasePublisher';
import { createLogger } from '../logger';

const log = createLogger('news:press-feed-store');

function base(url: string): string {
  return url.replace(/\/+$/, '');
}

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : [];
}

function asCategory(x: unknown): DailyCategory {
  return isDailyCategory(x) ? x : 'misc';
}

function asPositiveInt(x: unknown, fallback: number): number {
  const n = typeof x === 'number' ? x : Number(x);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** Convertit une ligne `press_feeds` (snake_case) en PressFeed. Tolérant. */
export function rowToPressFeed(r: Record<string, unknown>): PressFeed | null {
  const id = typeof r['id'] === 'string' ? r['id'] : null;
  const name = typeof r['name'] === 'string' ? r['name'].trim() : '';
  if (id === null || name.length === 0) return null;
  const includeRegex = typeof r['include_regex'] === 'string' && r['include_regex'].length > 0 ? r['include_regex'] : null;
  const excludeRegex = typeof r['exclude_regex'] === 'string' && r['exclude_regex'].length > 0 ? r['exclude_regex'] : null;
  return {
    id,
    name,
    category: asCategory(r['category']),
    sourceIds: asStringArray(r['source_ids']),
    feedUrls: asStringArray(r['feed_urls']),
    includeKeywords: asStringArray(r['include_keywords']),
    includeRegex,
    excludeRegex,
    sinceHours: asPositiveInt(r['since_hours'], 24),
    articleLimit: asPositiveInt(r['article_limit'], 12),
    enabled: r['enabled'] !== false,
  };
}

/**
 * Lit les journaux personnalisés ACTIFS depuis Supabase avec le compte admin.
 * Renvoie [] en cas d'échec (réseau, auth, table absente) — non bloquant : le
 * digest standard tourne quand même.
 */
export async function fetchEnabledPressFeeds(cfg: SupabaseAdminConfig): Promise<PressFeed[]> {
  let jwt: string;
  try {
    jwt = await signIn(cfg);
  } catch (err) {
    log.warn('Press feeds: admin sign-in failed', { error: String(err) });
    return [];
  }

  try {
    const q = 'enabled=eq.true&select=*';
    const res = await fetch(`${base(cfg.url)}/rest/v1/press_feeds?${q}`, {
      headers: { apikey: cfg.anonKey, Authorization: `Bearer ${jwt}` },
    });
    if (!res.ok) {
      log.warn('Press feeds: fetch failed', { status: res.status });
      return [];
    }
    const rows: unknown = await res.json().catch(() => null);
    if (!Array.isArray(rows)) return [];
    const feeds = rows
      .filter((r): r is Record<string, unknown> => r !== null && typeof r === 'object')
      .map(rowToPressFeed)
      .filter((f): f is PressFeed => f !== null);
    log.info('Press feeds loaded', { count: feeds.length });
    return feeds;
  } catch (err) {
    log.warn('Press feeds: fetch error', { error: String(err) });
    return [];
  }
}
