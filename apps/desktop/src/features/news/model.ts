import type { NewsItem, NewsSeverity } from '@catdesk/shared-types';

/** Forme brute d'une ligne `news` (colonnes Postgres en snake_case). */
export interface NewsRow {
  id: string;
  title: string;
  body: string;
  severity: string;
  audience_client_id: string | null;
  published_at: string;
  expires_at: string | null;
}

const SEVERITIES: readonly NewsSeverity[] = ['info', 'success', 'warning', 'critical'];

function toSeverity(s: string): NewsSeverity {
  return SEVERITIES.includes(s as NewsSeverity) ? (s as NewsSeverity) : 'info';
}

/** Mappe une ligne Supabase vers le type partagé (gravité inconnue → info). */
export function rowToNews(r: NewsRow): NewsItem {
  return {
    id: r.id,
    title: r.title,
    body: r.body,
    severity: toSeverity(r.severity),
    audienceClientId: r.audience_client_id,
    publishedAt: r.published_at,
    expiresAt: r.expires_at,
  };
}
