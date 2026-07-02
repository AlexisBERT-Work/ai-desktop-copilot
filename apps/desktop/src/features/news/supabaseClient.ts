import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** Vrai si l'URL et la clé anon Supabase sont toutes deux fournies. */
export const isNewsConfigured: boolean = Boolean(url && anonKey);

/**
 * Client Supabase pour la news (lecture seule via RLS). Vaut `null` tant que
 * `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` ne sont pas définies : l'app
 * fonctionne sans Supabase, le bandeau news reste simplement masqué.
 */
export const supabase: SupabaseClient | null =
  isNewsConfigured && url && anonKey
    ? createClient(url, anonKey, {
        auth: { persistSession: true, autoRefreshToken: true },
      })
    : null;
