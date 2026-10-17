import type { PressFeed } from '@catdesk/shared-types';
import {
  authHeaders,
  signIn,
  supabaseUrl,
  SUPABASE_TIMEOUT_MS,
  type SupabaseAdminConfig,
} from './supabaseRest';
import { pressFeedFromRecord } from './pressFeedRecord';
import { createLogger } from '../logger';

const log = createLogger('news:press-feed-store');

/** Convertit une ligne `press_feeds` (snake_case) en PressFeed. Tolérant. */
export function rowToPressFeed(r: Record<string, unknown>): PressFeed | null {
  return pressFeedFromRecord(r, 'snake');
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
    const res = await fetch(supabaseUrl(cfg, `/rest/v1/press_feeds?${q}`), {
      headers: authHeaders(cfg, jwt),
      signal: AbortSignal.timeout(SUPABASE_TIMEOUT_MS),
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
