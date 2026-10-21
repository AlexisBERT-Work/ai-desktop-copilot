/**
 * Catalogue des sources de presse intégrées, exposé à l'UI (sélecteur de la
 * console admin). Les URLs et parseurs restent côté agent (NEWS_SOURCES dans
 * FetchTechNewsTool) — un test de synchronisation garantit la correspondance
 * id/label entre les deux.
 */

export type PressSourceGroup =
  | 'tech'
  | 'ai'
  | 'health'
  | 'markets'
  | 'macro'
  | 'general-fr'
  | 'international';

export interface PressSourceInfo {
  id: string;
  label: string;
  lang: 'fr' | 'en';
  group: PressSourceGroup;
}

export const PRESS_SOURCE_GROUP_LABEL: Record<PressSourceGroup, string> = {
  tech: 'Tech',
  ai: 'IA',
  health: 'Santé & pharma',
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
  { id: 'lemonde_pixels', label: 'Le Monde — Pixels', lang: 'fr', group: 'tech' },
  // ─── IA (flux vérifiés en direct le 2026-10-16) ──────────────
  { id: 'actuia', label: 'ActuIA', lang: 'fr', group: 'ai' },
  { id: 'jdn_ia', label: 'JDN — IA', lang: 'fr', group: 'ai' },
  { id: 'theverge_ai', label: 'The Verge — IA', lang: 'en', group: 'ai' },
  { id: 'techcrunch_ai', label: 'TechCrunch — IA', lang: 'en', group: 'ai' },
  { id: 'arstechnica_ai', label: 'Ars Technica — IA', lang: 'en', group: 'ai' },
  { id: 'mittr_ai', label: 'MIT Technology Review — IA', lang: 'en', group: 'ai' },
  { id: 'thedecoder', label: 'The Decoder', lang: 'en', group: 'ai' },
  { id: 'openai', label: 'OpenAI', lang: 'en', group: 'ai' },
  { id: 'deepmind', label: 'Google DeepMind', lang: 'en', group: 'ai' },
  { id: 'googleai', label: 'Google — IA', lang: 'en', group: 'ai' },
  { id: 'huggingface', label: 'Hugging Face', lang: 'en', group: 'ai' },
  { id: 'simonwillison', label: 'Simon Willison', lang: 'en', group: 'ai' },
  { id: 'oneusefulthing', label: 'One Useful Thing (Ethan Mollick)', lang: 'en', group: 'ai' },
  { id: 'understandingai', label: 'Understanding AI', lang: 'en', group: 'ai' },
  { id: 'normaltech', label: 'Normal Tech (ex-AI Snake Oil)', lang: 'en', group: 'ai' },
  { id: 'eu_digital', label: 'Commission européenne — numérique', lang: 'en', group: 'ai' },
  { id: 'importai', label: 'Import AI', lang: 'en', group: 'ai' },
  { id: 'interconnects', label: 'Interconnects', lang: 'en', group: 'ai' },
  { id: 'latentspace', label: 'Latent Space', lang: 'en', group: 'ai' },
  { id: 'euaiact', label: 'EU AI Act Newsletter', lang: 'en', group: 'ai' },
  { id: 'bensbites', label: "Ben's Bites", lang: 'en', group: 'ai' },
  { id: 'lmi_ia', label: 'Le Monde Informatique — IA', lang: 'fr', group: 'ai' },
  // ─── Santé & pharma ──────────────────────────────────────────
  { id: 'stat_healthtech', label: 'STAT — Health Tech', lang: 'en', group: 'health' },
  { id: 'endpoints', label: 'Endpoints News', lang: 'en', group: 'health' },
  { id: 'mindhealth', label: 'Mind Health', lang: 'fr', group: 'health' },
  { id: 'ema', label: 'EMA — actualités', lang: 'en', group: 'health' },
  { id: 'ddtrends', label: 'Drug Discovery & Development', lang: 'en', group: 'health' },
  { id: 'gen', label: 'GEN — Genetic Engineering News', lang: 'en', group: 'health' },
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
  { id: 'cnil', label: 'CNIL', lang: 'fr', group: 'general-fr' },
  // ─── International (EN) ──────────────────────────────────────
  { id: 'bbc', label: 'BBC News', lang: 'en', group: 'international' },
  { id: 'guardian', label: 'The Guardian', lang: 'en', group: 'international' },
  { id: 'aljazeera', label: 'Al Jazeera', lang: 'en', group: 'international' },
];
