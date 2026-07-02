/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL du projet Supabase (news). Vide = news désactivée. */
  readonly VITE_SUPABASE_URL?: string;
  /** Clé `anon` (publique) du projet Supabase. Jamais la `service_role`. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
