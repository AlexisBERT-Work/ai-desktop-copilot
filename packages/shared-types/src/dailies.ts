// ─── Dailys (Pilier B, flux éditorial) ─────────────────────────
// Briefings quotidiens rédigés par l'admin et diffusés en lecture seule.
// Distinct de `news` (alertes ponctuelles) : un flux catégorisé que chaque
// client filtre selon ses centres d'intérêt. Voir docs/projects/dashboard-dailies.md.

/** Catégories de daily (liste fixe). Sert au filtrage côté client. */
export const DAILY_CATEGORIES = ['markets', 'tech', 'crypto', 'macro', 'product', 'misc'] as const;

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

/**
 * Progression de la génération des dailys locales (notification
 * `press.local.progress` → event `press:progress`, affichée dans « Mes
 * journaux »). Un run dure plusieurs minutes : sans cela, « Générer
 * maintenant » mouline en silence.
 */
export interface PressRunStatus {
  state: 'running' | 'done' | 'error';
  /** Journal en cours (1-based) sur le total, pendant un run. */
  current?: number;
  total?: number;
  /** Nom du journal en cours de traitement. */
  journal?: string;
  /** Étape pour ce journal : collecte des articles, puis rédaction/vérification LLM. */
  phase?: 'collecte' | 'redaction';
  /** Dailys produites ou remplacées (état 'done'). */
  produced?: number;
  /** Message d'erreur (état 'error'). */
  error?: string;
  /** Horodatage ISO de l'événement. */
  at: string;
}

/**
 * Genre d'une daily, déduit du titre (le pipeline produit des préfixes stables) :
 * - 'topic'     : digest transversal trié par sujet     → « Sujet — … »
 * - 'synthesis' : synthèse transversale du jour          → « Synthèse du jour … »
 * - 'journal'   : revue d'un journal (défaut)            → « <Journal> — revue du … »
 * Permet d'offrir des widgets distincts (par sujet vs par journal).
 */
export type DailyKind = 'journal' | 'topic' | 'synthesis';

export function dailyKindFromTitle(title: string): DailyKind {
  if (title.startsWith('Sujet — ')) return 'topic';
  if (title.startsWith('Synthèse du jour')) return 'synthesis';
  return 'journal';
}

/** Filtre de genre porté par un widget dailys. */
export type DailyKindFilter = 'all' | 'journal' | 'topic';

export const DAILY_KIND_FILTER_LABEL: Record<DailyKindFilter, string> = {
  all: 'Tout',
  journal: 'Par journal',
  topic: 'Par sujet',
};
