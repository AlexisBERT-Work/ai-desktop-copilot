// ─── Journaux personnalisés (revue de presse admin) ────────────
// Un « journal personnalisé » est une recette de collecte définie par l'admin :
// des sources (ids intégrés et/ou URLs de flux RSS/Atom) + des règles de tri
// (mots-clés, regex inclure/exclure). Le planificateur agent-runtime l'exécute
// chaque jour et publie une daily par journal, visible de tous les clients.
// Voir docs/projects/dashboard-dailies.md.

import type { DailyCategory } from './dailies';

/** Définition d'un journal personnalisé (camelCase, côté client/runtime). */
export interface PressFeed {
  id: string;
  /** Nom affiché du journal (sert de titre de la daily). */
  name: string;
  /** Catégorie de la daily produite. */
  category: DailyCategory;
  /** Ids de sources intégrées (clés de NEWS_SOURCES côté runtime). */
  sourceIds: string[];
  /** URLs de flux RSS/Atom arbitraires. */
  feedUrls: string[];
  /** Mots-clés (« recherche de caractères ») : garde les articles qui en contiennent un. Vide = tout. */
  includeKeywords: string[];
  /** Motif regex : ne garde que les articles qui matchent (titre+extrait). Null = pas de contrainte. */
  includeRegex: string | null;
  /** Motif regex : retire les articles qui matchent. Null = aucune exclusion. */
  excludeRegex: string | null;
  /** Fenêtre temporelle en heures (articles plus vieux ignorés). */
  sinceHours: number;
  /** Nombre max d'articles retenus (les plus importants). */
  articleLimit: number;
  /** Actif : seul un journal actif est collecté/publié. */
  enabled: boolean;
}

/** Données saisies à la création/édition d'un journal personnalisé. */
export type PressFeedInput = Omit<PressFeed, 'id'>;

/** Valeurs par défaut d'un nouveau journal personnalisé. */
export const EMPTY_PRESS_FEED: PressFeedInput = {
  name: '',
  category: 'misc',
  sourceIds: [],
  feedUrls: [],
  includeKeywords: [],
  includeRegex: null,
  excludeRegex: null,
  sinceHours: 24,
  articleLimit: 12,
  enabled: true,
};
