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

  // ─── IA ──────────────────────────────────────────────────────
  // Flux vérifiés en direct le 2026-10-16 (journal « Actu IA » du référent IA).
  // Écartés ce jour-là : Le Big Data et L'Usine Digitale (403), VentureBeat
  // (429), Anthropic (pas de flux public).
  actuia: {
    id: 'actuia',
    label: 'ActuIA',
    lang: 'fr',
    kind: 'feed',
    url: 'https://www.actuia.com/feed/',
    category: 'tech',
  },
  jdn_ia: {
    id: 'jdn_ia',
    label: 'JDN — IA',
    lang: 'fr',
    kind: 'feed',
    url: 'https://www.journaldunet.com/intelligence-artificielle/rss/',
    category: 'tech',
  },
  theverge_ai: {
    id: 'theverge_ai',
    label: 'The Verge — IA',
    lang: 'en',
    kind: 'feed',
    url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml',
    category: 'tech',
  },
  techcrunch_ai: {
    id: 'techcrunch_ai',
    label: 'TechCrunch — IA',
    lang: 'en',
    kind: 'feed',
    url: 'https://techcrunch.com/category/artificial-intelligence/feed/',
    category: 'tech',
  },
  arstechnica_ai: {
    id: 'arstechnica_ai',
    label: 'Ars Technica — IA',
    lang: 'en',
    kind: 'feed',
    url: 'https://arstechnica.com/ai/feed/',
    category: 'tech',
  },
  mittr_ai: {
    id: 'mittr_ai',
    label: 'MIT Technology Review — IA',
    lang: 'en',
    kind: 'feed',
    url: 'https://www.technologyreview.com/topic/artificial-intelligence/feed',
    category: 'tech',
  },
  thedecoder: {
    id: 'thedecoder',
    label: 'The Decoder',
    lang: 'en',
    kind: 'feed',
    url: 'https://the-decoder.com/feed/',
    category: 'tech',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    lang: 'en',
    kind: 'feed',
    url: 'https://openai.com/news/rss.xml',
    category: 'tech',
  },
  deepmind: {
    id: 'deepmind',
    label: 'Google DeepMind',
    lang: 'en',
    kind: 'feed',
    url: 'https://deepmind.google/blog/rss.xml',
    category: 'tech',
  },
  googleai: {
    id: 'googleai',
    label: 'Google — IA',
    lang: 'en',
    kind: 'feed',
    url: 'https://blog.google/innovation-and-ai/technology/ai/rss/',
    category: 'tech',
  },
  huggingface: {
    id: 'huggingface',
    label: 'Hugging Face',
    lang: 'en',
    kind: 'feed',
    url: 'https://huggingface.co/blog/feed.xml',
    category: 'tech',
  },
  simonwillison: {
    id: 'simonwillison',
    label: 'Simon Willison',
    lang: 'en',
    kind: 'feed',
    url: 'https://simonwillison.net/atom/everything/',
    category: 'tech',
  },
  // Ajoutés le 2026-10-17 pour le récap « haut niveau » (analyses, régulation).
  importai: {
    id: 'importai',
    label: 'Import AI',
    lang: 'en',
    kind: 'feed',
    // Miroir WordPress : le flux Substack répond 403 aux serveurs de GitHub
    // Actions (vu le 2026-10-17), où tourne le brief quotidien.
    url: 'https://jack-clark.net/feed/',
    category: 'tech',
  },
  interconnects: {
    id: 'interconnects',
    label: 'Interconnects',
    lang: 'en',
    kind: 'feed',
    url: 'https://www.interconnects.ai/feed',
    category: 'tech',
  },
  latentspace: {
    id: 'latentspace',
    label: 'Latent Space',
    lang: 'en',
    kind: 'feed',
    url: 'https://www.latent.space/feed',
    category: 'tech',
  },
  euaiact: {
    id: 'euaiact',
    label: 'EU AI Act Newsletter',
    lang: 'en',
    kind: 'feed',
    url: 'https://artificialintelligenceact.substack.com/feed',
    category: 'tech',
  },
  bensbites: {
    id: 'bensbites',
    label: "Ben's Bites",
    lang: 'en',
    kind: 'feed',
    url: 'https://www.bensbites.com/feed',
    category: 'tech',
  },
  lmi_ia: {
    id: 'lmi_ia',
    label: 'Le Monde Informatique — IA',
    lang: 'fr',
    kind: 'feed',
    url: 'https://www.lemondeinformatique.fr/flux-rss/thematique/intelligence-artificielle/rss.xml',
    category: 'tech',
  },
  lemonde_pixels: {
    id: 'lemonde_pixels',
    label: 'Le Monde — Pixels',
    lang: 'fr',
    kind: 'feed',
    url: 'https://www.lemonde.fr/pixels/rss_full.xml',
    category: 'tech',
  },
  cnil: {
    id: 'cnil',
    label: 'CNIL',
    lang: 'fr',
    kind: 'feed',
    url: 'https://www.cnil.fr/fr/rss.xml',
    category: 'misc',
  },

  // ─── Santé & pharma (vérifiés le 2026-10-17, part d'IA mesurée) ──────
  stat_healthtech: {
    id: 'stat_healthtech',
    label: 'STAT — Health Tech',
    lang: 'en',
    kind: 'feed',
    url: 'https://www.statnews.com/category/health-tech/feed/',
    category: 'tech',
  },
  endpoints: {
    id: 'endpoints',
    label: 'Endpoints News',
    lang: 'en',
    kind: 'feed',
    url: 'https://endpoints.news/feed/',
    category: 'misc',
  },
  mindhealth: {
    id: 'mindhealth',
    label: 'Mind Health',
    lang: 'fr',
    kind: 'feed',
    url: 'https://www.mind.eu.com/health/feed/',
    category: 'tech',
  },
  ema: {
    id: 'ema',
    label: 'EMA — actualités',
    lang: 'en',
    kind: 'feed',
    url: 'https://www.ema.europa.eu/en/news.xml',
    category: 'misc',
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
