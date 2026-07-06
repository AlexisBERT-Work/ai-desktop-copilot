/**
 * Catalogue des sources de presse intégrées, exposé à l'UI (sélecteur de la
 * console admin). Les URLs et parseurs restent côté agent (NEWS_SOURCES dans
 * FetchTechNewsTool) — un test de synchronisation garantit la correspondance
 * id/label entre les deux.
 */

export type PressSourceGroup = 'tech' | 'markets' | 'macro' | 'general-fr' | 'international';

export interface PressSourceInfo {
  id: string;
  label: string;
  lang: 'fr' | 'en';
  group: PressSourceGroup;
}

export const PRESS_SOURCE_GROUP_LABEL: Record<PressSourceGroup, string> = {
  tech: 'Tech',
  markets: 'Finance & marchés',
  macro: 'Macro / économie',
  'general-fr': 'Généraliste FR',
  international: 'International',
};

export const PRESS_SOURCE_CATALOG: readonly PressSourceInfo[] = [
  // ─── Tech ────────────────────────────────────────────────────
  { id: 'hackernews', label: 'Hacker News', lang: 'en', group: 'tech' },
  { id: 'devto', label: 'DEV.to', lang: 'en', group: 'tech' },
  { id: 'theverge', label: 'The Verge', lang: 'en', group: 'tech' },
  { id: 'arstechnica', label: 'Ars Technica', lang: 'en', group: 'tech' },
  { id: 'techcrunch', label: 'TechCrunch', lang: 'en', group: 'tech' },
  { id: 'hackernoon', label: 'HackerNoon', lang: 'en', group: 'tech' },
  { id: 'numerama', label: 'Numerama', lang: 'fr', group: 'tech' },
  { id: 'nextinpact', label: 'Next', lang: 'fr', group: 'tech' },
  { id: 'lesnumeriques', label: 'Les Numériques', lang: 'fr', group: 'tech' },
  // ─── Finance / marchés ───────────────────────────────────────
  { id: 'latribune', label: 'La Tribune', lang: 'fr', group: 'markets' },
  { id: 'yahoofinance', label: 'Yahoo Finance', lang: 'en', group: 'markets' },
  { id: 'investing', label: 'Investing.com', lang: 'en', group: 'markets' },
  { id: 'marketwatch', label: 'MarketWatch', lang: 'en', group: 'markets' },
  { id: 'ft', label: 'Financial Times', lang: 'en', group: 'markets' },
  { id: 'cnbc', label: 'CNBC', lang: 'en', group: 'markets' },
  // ─── Macro / économie ────────────────────────────────────────
  { id: 'lemonde_eco', label: 'Le Monde — Économie', lang: 'fr', group: 'macro' },
  // ─── Généraliste FR ──────────────────────────────────────────
  { id: 'lemonde', label: 'Le Monde', lang: 'fr', group: 'general-fr' },
  { id: 'lefigaro', label: 'Le Figaro', lang: 'fr', group: 'general-fr' },
  { id: 'liberation', label: 'Libération', lang: 'fr', group: 'general-fr' },
  { id: 'france24', label: 'France 24', lang: 'fr', group: 'general-fr' },
  // ─── International (EN) ──────────────────────────────────────
  { id: 'bbc', label: 'BBC News', lang: 'en', group: 'international' },
  { id: 'guardian', label: 'The Guardian', lang: 'en', group: 'international' },
  { id: 'aljazeera', label: 'Al Jazeera', lang: 'en', group: 'international' },
];
