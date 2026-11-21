// Accès REST/Auth au projet Supabase de la presse, sans SDK : le runtime n'a
// besoin que de quelques appels (session, lecture, RPC, insertion). La
// connexion anonyme était recopiée trois fois (publication ouverte, lecteur
// des dailys partagées, et un `base()` par fichier) — elle vit ici.
//
// Toutes les requêtes portent un délai : sans lui, un Supabase qui ne répond
// pas bloquait la revue de presse indéfiniment (et son verrou « run en cours »
// avec elle, donc plus aucune publication jusqu'au redémarrage).

export interface SupabaseOpenConfig {
  url: string; // https://<ref>.supabase.co
  anonKey: string;
}

/** Accès admin (poste de référence uniquement) : journaux personnalisés, dailys manuelles. */
export interface SupabaseAdminConfig extends SupabaseOpenConfig {
  email: string;
  password: string;
}

export const SUPABASE_TIMEOUT_MS = 15_000;

/** URL absolue d'un chemin d'API (`/rest/v1/…`, `/auth/v1/…`), slash final du projet toléré. */
export function supabaseUrl(cfg: SupabaseOpenConfig, path: string): string {
  return `${cfg.url.replace(/\/+$/, '')}${path}`;
}

/** En-têtes d'une requête authentifiée (clé publique + JWT de session). */
export function authHeaders(cfg: SupabaseOpenConfig, jwt: string): Record<string, string> {
  return { apikey: cfg.anonKey, Authorization: `Bearer ${jwt}` };
}

function accessToken(data: unknown): string | null {
  const token =
    data !== null && typeof data === 'object'
      ? (data as Record<string, unknown>)['access_token']
      : null;
  return typeof token === 'string' && token.length > 0 ? token : null;
}

/**
 * Session anonyme (POST /auth/v1/signup sans identifiants). Chaque appel crée
 * un utilisateur anonyme côté Supabase : les appelants fréquents gardent le
 * JWT obtenu plutôt que de rappeler ceci à chaque requête.
 */
export async function anonSignIn(cfg: SupabaseOpenConfig): Promise<string> {
  const res = await fetch(supabaseUrl(cfg, '/auth/v1/signup'), {
    method: 'POST',
    headers: { apikey: cfg.anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(SUPABASE_TIMEOUT_MS),
  });
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`connexion anonyme refusée (HTTP ${res.status})`);
  const token = accessToken(data);
  if (token === null) throw new Error('connexion anonyme: access_token absent');
  return token;
}

/** Connexion admin (mot de passe) → JWT porteur du claim role=admin. */
export async function signIn(cfg: SupabaseAdminConfig): Promise<string> {
  const res = await fetch(supabaseUrl(cfg, '/auth/v1/token?grant_type=password'), {
    method: 'POST',
    headers: { apikey: cfg.anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: cfg.email, password: cfg.password }),
    signal: AbortSignal.timeout(SUPABASE_TIMEOUT_MS),
  });
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const msg =
      data !== null && typeof data === 'object' && 'error_description' in data
        ? String((data as Record<string, unknown>)['error_description'])
        : `HTTP ${res.status}`;
    throw new Error(`Connexion admin échouée: ${msg}`);
  }
  const token = accessToken(data);
  if (token === null) throw new Error('Connexion admin: access_token absent');
  return token;
}
