import type { DailyCategory } from '@catdesk/shared-types';

// ─── Source registry ──────────────────────────────────────────
// Toutes les sources sont gratuites et sans clé API. `kind` indique au
// fetcher comment parser la réponse (JSON spécifique vs flux RSS/Atom).

type SourceKind = 'hn' | 'devto' | 'feed';

interface SourceDef {
  id: string;
  label: string;
  lang: 'fr' | 'en';
  kind: SourceKind;
  url: string;
  /** Catégorie de daily attribuée aux articles de ce journal (filtrage client). */
  category: DailyCategory;
}

export const NEWS_SOURCES: Record<string, SourceDef> = {
  // ─── Tech ────────────────────────────────────────────────────
  hackernews: {
    id: 'hackernews',
    label: 'Hacker News',
    lang: 'en',
    kind: 'hn',
    url: 'https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=30',
    category: 'tech',
  },
  devto: {
    id: 'devto',
    label: 'DEV.to',
    lang: 'en',
    kind: 'devto',
    url: 'https://dev.to/api/articles?top=1&per_page=30',
    category: 'tech',
  },
  theverge: {
    id: 'theverge',
    label: 'The Verge',
    lang: 'en',
    kind: 'feed',
    url: 'https://www.theverge.com/rss/index.xml',
    category: 'tech',
  },
  arstechnica: {
    id: 'arstechnica',
    label: 'Ars Technica',
    lang: 'en',
    kind: 'feed',
    url: 'https://feeds.arstechnica.com/arstechnica/index',
    category: 'tech',
  },
  techcrunch: {
    id: 'techcrunch',
    label: 'TechCrunch',
    lang: 'en',
    kind: 'feed',
    url: 'https://techcrunch.com/feed/',
    category: 'tech',
  },
  hackernoon: {
    id: 'hackernoon',
    label: 'HackerNoon',
    lang: 'en',
    kind: 'feed',
    url: 'https://hackernoon.com/feed',
    category: 'tech',
  },
  numerama: {
    id: 'numerama',
    label: 'Numerama',
    lang: 'fr',
    kind: 'feed',
    url: 'https://www.numerama.com/feed/',
    category: 'tech',
  },
  nextinpact: {
    id: 'nextinpact',
    label: 'Next',
    lang: 'fr',
    kind: 'feed',
    url: 'https://next.ink/feed/',
    category: 'tech',
  },
  lesnumeriques: {
    id: 'lesnumeriques',
    label: 'Les Numériques',
    lang: 'fr',
    kind: 'feed',
    url: 'https://www.lesnumeriques.com/rss.xml',
    category: 'tech',
  },

  // ─── Finance / marchés ───────────────────────────────────────
  // (Les Échos retiré : flux en 403 systématique. La Tribune + Yahoo Finance OK.)
  latribune: {
    id: 'latribune',
    label: 'La Tribune',
    lang: 'fr',
    kind: 'feed',
    url: 'https://www.latribune.fr/feed.xml',
    category: 'markets',
  },
  yahoofinance: {
    id: 'yahoofinance',
    label: 'Yahoo Finance',
    lang: 'en',
    kind: 'feed',
    url: 'https://finance.yahoo.com/news/rssindex',
    category: 'markets',
  },
  investing: {
    id: 'investing',
    label: 'Investing.com',
    lang: 'en',
    kind: 'feed',
    url: 'https://www.investing.com/rss/news_25.rss',
    category: 'markets',
  },
  marketwatch: {
    id: 'marketwatch',
    label: 'MarketWatch',
    lang: 'en',
    kind: 'feed',
    url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories',
    category: 'markets',
  },
  ft: {
    id: 'ft',
    label: 'Financial Times',
    lang: 'en',
    kind: 'feed',
    url: 'https://www.ft.com/rss/home',
    category: 'markets',
  },
  cnbc: {
    id: 'cnbc',
    label: 'CNBC',
    lang: 'en',
    kind: 'feed',
    url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114',
    category: 'markets',
  },

  // ─── Macro / économie ────────────────────────────────────────
  lemonde_eco: {
    id: 'lemonde_eco',
    label: 'Le Monde — Économie',
    lang: 'fr',
    kind: 'feed',
    url: 'https://www.lemonde.fr/economie/rss_full.xml',
    category: 'macro',
  },

  // ─── Généraliste FR ──────────────────────────────────────────
  lemonde: {
    id: 'lemonde',
    label: 'Le Monde',
    lang: 'fr',
    kind: 'feed',
    url: 'https://www.lemonde.fr/rss/une.xml',
    category: 'misc',
  },
  lefigaro: {
    id: 'lefigaro',
    label: 'Le Figaro',
    lang: 'fr',
    kind: 'feed',
    url: 'https://www.lefigaro.fr/rss/figaro_actualites.xml',
    category: 'misc',
  },
  liberation: {
    id: 'liberation',
    label: 'Libération',
    lang: 'fr',
    kind: 'feed',
    url: 'https://www.liberation.fr/arc/outboundfeeds/rss/?outputType=xml',
    category: 'misc',
  },
  france24: {
    id: 'france24',
    label: 'France 24',
    lang: 'fr',
    kind: 'feed',
    url: 'https://www.france24.com/fr/rss',
    category: 'misc',
  },

  // ─── International (EN) ───────────────────────────────────────
  bbc: {
    id: 'bbc',
    label: 'BBC News',
    lang: 'en',
    kind: 'feed',
    url: 'https://feeds.bbci.co.uk/news/world/rss.xml',
    category: 'misc',
  },
  guardian: {
    id: 'guardian',
    label: 'The Guardian',
    lang: 'en',
    kind: 'feed',
    url: 'https://www.theguardian.com/world/rss',
    category: 'misc',
  },
  aljazeera: {
    id: 'aljazeera',
    label: 'Al Jazeera',
    lang: 'en',
    kind: 'feed',
    url: 'https://www.aljazeera.com/xml/rss/all.xml',
    category: 'misc',
  },
};

export const DEFAULT_SOURCES = ['hackernews', 'theverge', 'techcrunch', 'devto'];

/** Catégorie d'un journal (par label de source). Repli 'misc' pour les flux custom. */
export function categoryForSourceLabel(label: string): DailyCategory {
  for (const def of Object.values(NEWS_SOURCES)) {
    if (def.label === label) return def.category;
  }
  return 'misc';
}

/** Derive a readable source label from a feed URL ("blog.rust-lang.org"). */
export function feedLabelFromUrl(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, '');
  } catch {
    return rawUrl;
  }
}
