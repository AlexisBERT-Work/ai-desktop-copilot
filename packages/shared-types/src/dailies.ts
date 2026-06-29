// ─── Dailys (Pilier B, flux éditorial) ─────────────────────────
// Briefings quotidiens rédigés par l'admin et diffusés en lecture seule.
// Distinct de `news` (alertes ponctuelles) : un flux catégorisé que chaque
// client filtre selon ses centres d'intérêt. Voir docs/projects/dashboard-dailies.md.

/** Catégories de daily (liste fixe). Sert au filtrage côté client. */
export const DAILY_CATEGORIES = [
  'markets',
  'tech',
  'crypto',
  'macro',
  'product',
  'misc',
] as const;

export type DailyCategory = (typeof DAILY_CATEGORIES)[number];

/** Libellés FR affichés dans l'UI (chips de filtre, badge de catégorie). */
export const DAILY_CATEGORY_LABEL: Record<DailyCategory, string> = {
  markets: 'Marchés',
  tech: 'Tech',
  crypto: 'Crypto',
  macro: 'Macro',
  product: 'Produit',
  misc: 'Divers',
};

export function isDailyCategory(x: unknown): x is DailyCategory {
  return typeof x === 'string' && (DAILY_CATEGORIES as readonly string[]).includes(x);
}

/** Une daily, telle que consommée côté client (camelCase). */
export interface Daily {
  id: string;
  title: string;
  body: string; // Markdown
  category: DailyCategory;
  publishedAt: string; // ISO 8601
  expiresAt: string | null; // ISO 8601 ou null
}
