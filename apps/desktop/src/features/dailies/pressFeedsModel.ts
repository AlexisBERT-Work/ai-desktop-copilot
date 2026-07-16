import {
  EMPTY_PRESS_FEED,
  PRESS_SOURCE_CATALOG,
  type DailyCategory,
  type PressFeed,
  type PressFeedInput,
} from '@catdesk/shared-types';

/**
 * Logique métier du gestionnaire de journaux personnalisés — extraite de
 * PressFeedsManager.tsx pour être testée sans DOM (parsing des champs texte,
 * validation regex, mapping brouillon ↔ modèle).
 */

/** Brouillon d'édition : les champs listes sont saisis en texte, convertis au save. */
export interface Draft {
  name: string;
  category: DailyCategory;
  sourceIds: string[]; // sélection dans le catalogue intégré
  feedUrls: string; // une URL par ligne
  includeKeywords: string; // séparés par des virgules
  includeRegex: string;
  excludeRegex: string;
  sinceHours: number;
  articleLimit: number;
  enabled: boolean;
}

export const EMPTY_DRAFT: Draft = {
  name: '',
  category: 'misc',
  sourceIds: [],
  feedUrls: '',
  includeKeywords: '',
  includeRegex: '',
  excludeRegex: '',
  sinceHours: EMPTY_PRESS_FEED.sinceHours,
  articleLimit: EMPTY_PRESS_FEED.articleLimit,
  enabled: true,
};

export const csv = (s: string): string[] =>
  s
    .split(',')
    .map(x => x.trim())
    .filter(x => x.length > 0);

export const lines = (s: string): string[] =>
  s
    .split(/\r?\n/)
    .map(x => x.trim())
    .filter(x => x.length > 0);

export function feedToDraft(f: PressFeed): Draft {
  return {
    name: f.name,
    category: f.category,
    sourceIds: f.sourceIds,
    feedUrls: f.feedUrls.join('\n'),
    includeKeywords: f.includeKeywords.join(', '),
    includeRegex: f.includeRegex ?? '',
    excludeRegex: f.excludeRegex ?? '',
    sinceHours: f.sinceHours,
    articleLimit: f.articleLimit,
    enabled: f.enabled,
  };
}

export function draftToInput(d: Draft): PressFeedInput {
  return {
    name: d.name.trim(),
    category: d.category,
    sourceIds: d.sourceIds,
    feedUrls: lines(d.feedUrls),
    includeKeywords: csv(d.includeKeywords),
    includeRegex: d.includeRegex.trim() === '' ? null : d.includeRegex.trim(),
    excludeRegex: d.excludeRegex.trim() === '' ? null : d.excludeRegex.trim(),
    sinceHours: d.sinceHours,
    articleLimit: d.articleLimit,
    enabled: d.enabled,
  };
}

/** Message d'erreur d'un motif regex utilisateur, null si valide ou vide. */
export function regexError(pattern: string): string | null {
  if (pattern.trim() === '') return null;
  try {
    new RegExp(pattern, 'iu');
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : 'motif invalide';
  }
}

/** Minuscules sans accents, pour une recherche tolérante (« libe » → Libération). */
export const fold = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');

const SOURCE_LABEL = new Map(PRESS_SOURCE_CATALOG.map(s => [s.id, s.label]));

/** Résumé lisible des sources d'un journal (labels du catalogue + nb de flux perso). */
export function sourceSummary(f: PressFeed): string {
  const parts = f.sourceIds.map(id => SOURCE_LABEL.get(id) ?? id);
  if (f.feedUrls.length > 0) parts.push(`${f.feedUrls.length} flux perso`);
  return parts.length > 0 ? parts.join(', ') : 'aucune source';
}
