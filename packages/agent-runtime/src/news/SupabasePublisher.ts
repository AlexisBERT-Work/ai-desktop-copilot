import type { JournalDraft } from './pressDigest';
import {
  anonSignIn,
  authHeaders,
  signIn,
  supabaseUrl,
  SUPABASE_TIMEOUT_MS,
  type SupabaseAdminConfig,
  type SupabaseOpenConfig,
} from './supabaseRest';
import { createLogger } from '../logger';

export type { SupabaseAdminConfig, SupabaseOpenConfig } from './supabaseRest';

const log = createLogger('news:supabase-publish');

export interface PublishResult {
  published: number;
  skipped: number;
  errors: string[];
  /** Drafts réellement insérés (hors doublons ignorés) — pour miroir Discord. */
  publishedDrafts: JournalDraft[];
}

function emptyResult(): PublishResult {
  return { published: 0, skipped: 0, errors: [], publishedDrafts: [] };
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Vrai si une daily de même titre existe déjà (idempotence du cron quotidien). */
async function dailyExists(cfg: SupabaseAdminConfig, jwt: string, title: string): Promise<boolean> {
  const q = `title=eq.${encodeURIComponent(title)}&select=id&limit=1`;
  const res = await fetch(supabaseUrl(cfg, `/rest/v1/dailies?${q}`), {
    headers: authHeaders(cfg, jwt),
    signal: AbortSignal.timeout(SUPABASE_TIMEOUT_MS),
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
  const res = await fetch(supabaseUrl(cfg, '/rest/v1/dailies'), {
    method: 'POST',
    headers: {
      ...authHeaders(cfg, jwt),
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ title: draft.title, body: draft.body, category: draft.category }),
    signal: AbortSignal.timeout(SUPABASE_TIMEOUT_MS),
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
  const result = emptyResult();
  if (drafts.length === 0) return result;

  let jwt: string;
  try {
    jwt = await signIn(cfg);
  } catch (err) {
    result.errors.push(errorText(err));
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
      result.errors.push(`${draft.journal}: ${errorText(err)}`);
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

/** Le lot standard du jour : déjà publié, manquant, ou impossible à savoir (Supabase injoignable). */
export type SharedDigestState = 'published' | 'missing' | 'unreachable';

/**
 * Le lot standard du jour est-il déjà publié (début du jour local de CE
 * poste) ? Évite de regénérer localement (coût LLM réel : plusieurs minutes de
 * GPU) un lot déjà couvert par un autre poste.
 *
 * - Lecture refusée (HTTP en erreur) → 'missing' : dans le doute on génère,
 *   la RPC idempotente rattrape un doublon — mieux qu'un jour sans daily.
 * - Supabase INJOIGNABLE (réseau, DNS, projet en pause, session anonyme
 *   refusée) → 'unreachable' : la publication échouerait de la même façon.
 *   Générer quand même, c'était plusieurs minutes de GPU à CHAQUE lancement de
 *   CatDesk pour un lot jeté — pendant que l'utilisateur attendait sa réponse.
 */
export async function sharedDigestState(cfg: SupabaseOpenConfig): Promise<SharedDigestState> {
  let jwt: string;
  try {
    jwt = await anonSignIn(cfg);
  } catch {
    return 'unreachable';
  }
  try {
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    const q = `select=id&published_at=gte.${encodeURIComponent(since.toISOString())}&limit=1`;
    const res = await fetch(supabaseUrl(cfg, `/rest/v1/dailies?${q}`), {
      headers: authHeaders(cfg, jwt),
      signal: AbortSignal.timeout(SUPABASE_TIMEOUT_MS),
    });
    if (!res.ok) return 'missing';
    const rows: unknown = await res.json().catch(() => null);
    return Array.isArray(rows) && rows.length > 0 ? 'published' : 'missing';
  } catch {
    return 'unreachable';
  }
}

async function publishOneOpen(
  cfg: SupabaseOpenConfig,
  jwt: string,
  draft: JournalDraft,
): Promise<boolean> {
  const res = await fetch(supabaseUrl(cfg, '/rest/v1/rpc/publish_daily_if_missing'), {
    method: 'POST',
    headers: { ...authHeaders(cfg, jwt), 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_title: draft.title, p_body: draft.body, p_category: draft.category }),
    signal: AbortSignal.timeout(SUPABASE_TIMEOUT_MS),
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
  const result = emptyResult();
  if (drafts.length === 0) return result;

  let jwt: string;
  try {
    jwt = await anonSignIn(cfg);
  } catch (err) {
    result.errors.push(errorText(err));
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
      result.errors.push(`${draft.journal}: ${errorText(err)}`);
    }
  }

  log.info('Dailies published (open/anon)', {
    published: result.published,
    skipped: result.skipped,
    errors: result.errors.length,
  });
  return result;
}
