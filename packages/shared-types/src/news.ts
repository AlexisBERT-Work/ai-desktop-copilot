// ─── News (Pilier B) ───────────────────────────────────────────
// Annonces pilotées par l'admin, diffusées via le backend Supabase. Les clients
// sont en LECTURE SEULE (imposé par RLS). Voir docs/projects/dashboard-p2.md.

export type NewsSeverity = 'info' | 'success' | 'warning' | 'critical';

/** Une annonce, telle que consommée côté client (camelCase). */
export interface NewsItem {
  id: string;
  title: string;
  body: string; // Markdown
  severity: NewsSeverity;
  /** null = globale ; sinon cible un client précis (auth.uid()). */
  audienceClientId: string | null;
  publishedAt: string; // ISO 8601
  expiresAt: string | null; // ISO 8601 ou null
}

/** Identité d'installation, émise par Supabase Auth (anonyme par défaut). */
export interface ClientIdentity {
  clientId: string; // = auth.uid()
}
