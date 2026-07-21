import type { JournalDraft } from './pressDigest';
import { createLogger } from '../logger';

const log = createLogger('news:supabase-publish');

/** Config d'accès admin au backend Supabase (poste de référence uniquement). */
export interface SupabaseAdminConfig {
  url: string; // https://<ref>.supabase.co
  anonKey: string;
  email: string;
  password: string;
}

export interface PublishResult {
  published: number;
  skipped: number;
  errors: string[];
  /** Drafts réellement insérés (hors doublons ignorés) — pour miroir Discord. */
  publishedDrafts: JournalDraft[];
}

function base(url: string): string {
  return url.replace(/\/+$/, '');
}

/** Connexion admin (mot de passe) → renvoie un JWT porteur du claim role=admin. */
export async function signIn(cfg: SupabaseAdminConfig): Promise<string> {
  const res = await fetch(`${base(cfg.url)}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: cfg.anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: cfg.email, password: cfg.password }),
  });
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const msg =
      data !== null && typeof data === 'object' && 'error_description' in data
        ? String((data as Record<string, unknown>)['error_description'])
        : `HTTP ${res.status}`;
    throw new Error(`Connexion admin échouée: ${msg}`);
  }
  const token =
    data !== null && typeof data === 'object'
      ? (data as Record<string, unknown>)['access_token']
      : null;
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error('Connexion admin: access_token absent');
  }
  return token;
}

/** Vrai si une daily de même titre existe déjà (idempotence du cron quotidien). */
async function dailyExists(cfg: SupabaseAdminConfig, jwt: string, title: string): Promise<boolean> {
  const q = `title=eq.${encodeURIComponent(title)}&select=id&limit=1`;
  const res = await fetch(`${base(cfg.url)}/rest/v1/dailies?${q}`, {
    headers: { apikey: cfg.anonKey, Authorization: `Bearer ${jwt}` },
  });
  if (!res.ok) return false; // en cas de doute, on tente l'insertion
  const rows: unknown = await res.json().catch(() => null);
  return Array.isArray(rows) && rows.length > 0;
}

async function insertDaily(
  cfg: SupabaseAdminConfig,
  jwt: string,
  draft: JournalDraft,
): Promise<void> {
  const res = await fetch(`${base(cfg.url)}/rest/v1/dailies`, {
    method: 'POST',
    headers: {
      apikey: cfg.anonKey,
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ title: draft.title, body: draft.body, category: draft.category }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`insert ${res.status}: ${text.slice(0, 200)}`);
  }
}

/**
 * Publie les dailys dans Supabase avec le compte admin. Idempotent : une daily
 * dont le titre existe déjà est ignorée (cron quotidien sûr à rejouer). Une
 * erreur sur une daily n'interrompt pas les autres.
 */
export async function publishDailies(
  cfg: SupabaseAdminConfig,
  drafts: JournalDraft[],
): Promise<PublishResult> {
  const result: PublishResult = { published: 0, skipped: 0, errors: [], publishedDrafts: [] };
  if (drafts.length === 0) return result;

  let jwt: string;
  try {
    jwt = await signIn(cfg);
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : String(err));
    return result;
  }

  for (const draft of drafts) {
    try {
      if (await dailyExists(cfg, jwt, draft.title)) {
        result.skipped += 1;
        continue;
      }
      await insertDaily(cfg, jwt, draft);
      result.published += 1;
      result.publishedDrafts.push(draft);
    } catch (err) {
      result.errors.push(`${draft.journal}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  log.info('Dailies published', {
    published: result.published,
    skipped: result.skipped,
    errors: result.errors.length,
  });
  return result;
}

// ─── Publication ouverte (anon, sans identifiants admin) ───────
// Tri modèles 2026-07-20 : le lot standard (7 journaux + sujets + synthèse) se
// publie depuis N'IMPORTE QUEL poste ayant lancé CatDesk, pas seulement celui
// de l'admin. Passe par `publish_daily_if_missing` (RPC Postgres, SECURITY
// DEFINER) qui valide elle-même titre/catégorie/plafond — voir
// supabase/migrations/20260720000000_press_digest_open_publish.sql. Les
// journaux personnalisés (press_feeds) et les dailys manuelles restent
// publiés via `publishDailies` ci-dessus (identifiants admin, RLS directe).

export interface SupabaseOpenConfig {
  url: string;
  anonKey: string;
}

/** Session anonyme (POST /auth/v1/signup sans identifiants) — même flux que SharedDailyReader. */
async function anonSignIn(cfg: SupabaseOpenConfig): Promise<string> {
  const res = await fetch(`${base(cfg.url)}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: cfg.anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
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
  return token;
}

/**
 * Vrai si au moins une daily a déjà été publiée aujourd'hui (comparaison sur
 * le début du jour local de CE poste). Utilisé pour éviter de regénérer
 * localement (coût LLM réel) un lot déjà couvert par un autre poste. En cas de
 * doute (réseau indisponible), renvoie faux : on préfère une génération
 * redondante — rattrapée par l'idempotence de la RPC — à un jour sans daily.
 */
export async function hasTodaysSharedDigest(cfg: SupabaseOpenConfig): Promise<boolean> {
  try {
    const jwt = await anonSignIn(cfg);
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    const q = `select=id&published_at=gte.${encodeURIComponent(since.toISOString())}&limit=1`;
    const res = await fetch(`${base(cfg.url)}/rest/v1/dailies?${q}`, {
      headers: { apikey: cfg.anonKey, Authorization: `Bearer ${jwt}` },
    });
    if (!res.ok) return false;
    const rows: unknown = await res.json().catch(() => null);
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  }
}

async function publishOneOpen(
  cfg: SupabaseOpenConfig,
  jwt: string,
  draft: JournalDraft,
): Promise<boolean> {
  const res = await fetch(`${base(cfg.url)}/rest/v1/rpc/publish_daily_if_missing`, {
    method: 'POST',
    headers: {
      apikey: cfg.anonKey,
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_title: draft.title, p_body: draft.body, p_category: draft.category }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`rpc ${res.status}: ${text.slice(0, 200)}`);
  }
  const inserted: unknown = await res.json().catch(() => null);
  return inserted === true;
}

/**
 * Publie le lot standard sans identifiants admin, via une session anonyme +
 * la RPC `publish_daily_if_missing`. Idempotent (contrainte unique sur
 * `title`) : si un autre poste a déjà publié le même titre entretemps, cet
 * appel devient un no-op silencieux (`skipped`), jamais une erreur.
 */
export async function publishDailiesOpen(
  cfg: SupabaseOpenConfig,
  drafts: JournalDraft[],
): Promise<PublishResult> {
  const result: PublishResult = { published: 0, skipped: 0, errors: [], publishedDrafts: [] };
  if (drafts.length === 0) return result;

  let jwt: string;
  try {
    jwt = await anonSignIn(cfg);
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : String(err));
    return result;
  }

  for (const draft of drafts) {
    try {
      if (await publishOneOpen(cfg, jwt, draft)) {
        result.published += 1;
        result.publishedDrafts.push(draft);
      } else {
        result.skipped += 1;
      }
    } catch (err) {
      result.errors.push(`${draft.journal}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  log.info('Dailies published (open/anon)', {
    published: result.published,
    skipped: result.skipped,
    errors: result.errors.length,
  });
  return result;
}
