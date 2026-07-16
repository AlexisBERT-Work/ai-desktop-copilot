import { isDailyCategory, type Daily } from '@catdesk/shared-types';

/** Forme brute d'une ligne `dailies` (colonnes Postgres en snake_case). */
export interface DailyRow {
  id: string;
  title: string;
  body: string;
  category: string;
  published_at: string;
  expires_at: string | null;
}

/** Mappe une ligne Supabase vers le type partagé (catégorie inconnue → misc). */
export function rowToDaily(r: DailyRow): Daily {
  return {
    id: r.id,
    title: r.title,
    body: r.body,
    category: isDailyCategory(r.category) ? r.category : 'misc',
    publishedAt: r.published_at,
    expiresAt: r.expires_at,
  };
}
