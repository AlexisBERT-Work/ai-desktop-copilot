import { postJson } from '../../lib/http';
import { SUPABASE_TIMEOUT_MS, authHeaders, supabaseUrl } from '../supabaseRest';
import type { FilCard } from './filCards';

// Publication des cartes du Fil dans `catdesk-news`, par la RPC `fil_publish`
// (supabase/migrations/20261108000000_fil.sql) : clé anon + jeton de
// publication. Le jeton n'apparaît jamais dans une erreur ni dans un log.

type EnvLike = Record<string, string | undefined>;

export interface FilPublishConfig {
  url: string;
  anonKey: string;
  token: string;
}

/** La RPC refuse au-delà : on découpe. */
export const FIL_PER_CALL = 60;

/** Configuration de publication ; les trois valeurs sont exigées. Pur. */
export function readFilPublishConfig(
  env: EnvLike,
): { ok: true; config: FilPublishConfig } | { ok: false; error: string } {
  const url = env['FIL_SUPABASE_URL']?.trim() ?? '';
  const anonKey = env['FIL_SUPABASE_ANON_KEY']?.trim() ?? '';
  const token = env['FIL_PUBLISH_TOKEN']?.trim() ?? '';
  const missing = [
    ...(url === '' ? ['FIL_SUPABASE_URL'] : []),
    ...(anonKey === '' ? ['FIL_SUPABASE_ANON_KEY'] : []),
    ...(token === '' ? ['FIL_PUBLISH_TOKEN'] : []),
  ];
  if (missing.length > 0) return { ok: false, error: `Fil : ${missing.join(', ')} manquant` };
  if (!/^https:\/\//.test(url))
    return { ok: false, error: 'Fil : FIL_SUPABASE_URL doit être en https' };
  return { ok: true, config: { url, anonKey, token } };
}

type Post = typeof postJson;

function errorMessage(text: string): string {
  try {
    const data = JSON.parse(text) as unknown;
    if (data !== null && typeof data === 'object' && 'message' in data) {
      return String((data as Record<string, unknown>)['message']).slice(0, 200);
    }
  } catch {
    // corps non JSON : on ne recopie pas une page d'erreur entière
  }
  return 'réponse illisible';
}

/**
 * Publie les cartes, par paquets de FIL_PER_CALL. Idempotent : une carte déjà
 * publiée est ignorée par la base. Renvoie le nombre de cartes nouvelles.
 */
export async function publishFil(
  cfg: FilPublishConfig,
  cards: readonly FilCard[],
  post: Post = postJson,
): Promise<{ ok: true; inserted: number } | { ok: false; error: string }> {
  let inserted = 0;
  for (let i = 0; i < cards.length; i += FIL_PER_CALL) {
    const batch = cards.slice(i, i + FIL_PER_CALL);
    let res: { status: number; text: string };
    try {
      res = await post(
        supabaseUrl(cfg, '/rest/v1/rpc/fil_publish'),
        { p_token: cfg.token, p_cards: batch },
        { timeoutMs: SUPABASE_TIMEOUT_MS, headers: authHeaders(cfg, cfg.anonKey) },
      );
    } catch (err) {
      return {
        ok: false,
        error: `Fil injoignable : ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    if (res.status < 200 || res.status >= 300) {
      return { ok: false, error: `Fil : HTTP ${res.status}, ${errorMessage(res.text)}` };
    }
    const count = Number(res.text);
    if (!Number.isInteger(count))
      return { ok: false, error: 'Fil : réponse inattendue de la base' };
    inserted += count;
  }
  return { ok: true, inserted };
}
