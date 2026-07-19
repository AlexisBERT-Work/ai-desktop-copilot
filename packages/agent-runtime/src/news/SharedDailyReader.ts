import type { Daily } from '@catdesk/shared-types';
import { isDailyCategory } from '@catdesk/shared-types';
import { createLogger } from '../logger';

const log = createLogger('news:shared-dailies');

const FETCH_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 60_000;
const FETCH_LIMIT = 100;

/** Ligne brute de la table `dailies` (colonnes Postgres en snake_case). */
interface DailyRow {
  id: string;
  title: string;
  body: string;
  category: string;
  published_at: string;
  expires_at: string | null;
}

export interface SharedDailiesResult {
  items: Daily[];
  /** Renseigné si la source partagée est indisponible (l'outil le signale au LLM). */
  error?: string;
}

function isDailyRow(x: unknown): x is DailyRow {
  if (x === null || typeof x !== 'object') return false;
  const r = x as Record<string, unknown>;
  return (
    typeof r['id'] === 'string' &&
    typeof r['title'] === 'string' &&
    typeof r['body'] === 'string' &&
    typeof r['published_at'] === 'string'
  );
}

function rowToDaily(r: DailyRow): Daily {
  return {
    id: r.id,
    title: r.title,
    body: r.body,
    category: isDailyCategory(r.category) ? r.category : 'misc',
    publishedAt: r.published_at,
    expiresAt: r.expires_at ?? null,
    origin: 'shared',
  };
}

/**
 * Lecture ANONYME des dailys partagées (Supabase) depuis le runtime — le même
 * flux que le widget affiche, mais accessible à l'agent pour répondre aux
 * questions sur les articles. La RLS n'ouvre la lecture qu'aux sessions
 * authentifiées : on ouvre une session anonyme (comme le fait l'UI) puis on
 * interroge le REST. Sans SUPABASE_URL/SUPABASE_ANON_KEY dans l'env, la source
 * est simplement absente (les dailys locales restent disponibles).
 */
export class SharedDailyReader {
  private readonly url: string | undefined;
  private readonly anonKey: string | undefined;
  private jwt: string | null = null;
  private cache: { items: Daily[]; at: number } | null = null;

  constructor(url = process.env['SUPABASE_URL'], anonKey = process.env['SUPABASE_ANON_KEY']) {
    this.url = url?.replace(/\/+$/, '');
    this.anonKey = anonKey;
  }

  get configured(): boolean {
    return this.url !== undefined && this.url.length > 0 && this.anonKey !== undefined;
  }

  async fetch(): Promise<SharedDailiesResult> {
    if (!this.configured) {
      return {
        items: [],
        error: 'Dailys partagées non configurées sur ce poste (locales seulement).',
      };
    }
    if (this.cache !== null && Date.now() - this.cache.at < CACHE_TTL_MS) {
      return { items: this.cache.items };
    }
    try {
      let items = await this.fetchRows();
      // JWT anonyme expiré entre deux appels → une seule nouvelle session puis retry.
      if (items === null) {
        this.jwt = null;
        items = await this.fetchRows();
      }
      if (items === null) throw new Error('lecture refusée (auth anonyme)');
      this.cache = { items, at: Date.now() };
      return { items };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('Dailys partagées inaccessibles', { error: msg });
      return { items: [], error: `Dailys partagées inaccessibles: ${msg}` };
    }
  }

  /** GET REST des dailys, `null` si la session est rejetée (401/403 → re-login). */
  private async fetchRows(): Promise<Daily[] | null> {
    const jwt = await this.ensureSession();
    const q = `select=*&order=published_at.desc&limit=${FETCH_LIMIT}`;
    const res = await fetch(`${this.url}/rest/v1/dailies?${q}`, {
      headers: { apikey: this.anonKey ?? '', Authorization: `Bearer ${jwt}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.status === 401 || res.status === 403) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows: unknown = await res.json().catch(() => null);
    if (!Array.isArray(rows)) throw new Error('réponse inattendue');
    return rows.filter(isDailyRow).map(rowToDaily);
  }

  /** Session anonyme (POST /auth/v1/signup sans identifiants), JWT mémorisé. */
  private async ensureSession(): Promise<string> {
    if (this.jwt !== null) return this.jwt;
    const res = await fetch(`${this.url}/auth/v1/signup`, {
      method: 'POST',
      headers: { apikey: this.anonKey ?? '', 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const data: unknown = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`connexion anonyme refusée (HTTP ${res.status})`);
    const token =
      data !== null && typeof data === 'object'
        ? (data as Record<string, unknown>)['access_token']
        : null;
    if (typeof token !== 'string' || token.length === 0) {
      throw new Error('connexion anonyme: access_token absent');
    }
    this.jwt = token;
    return token;
  }
}
