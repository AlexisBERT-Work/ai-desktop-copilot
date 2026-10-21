import { aggregateNews } from '../aggregate';
import type { NewsItem } from '../newsItem';
import { cutAtSentence } from '../newsText';
import { NEWS_SOURCES } from '../sources';

// Collecte des articles candidats du brief : aucun LLM ici, seulement le
// pipeline RSS existant. Claude reçoit ce fichier et fait le tri lui-même.

/** Fichier des candidats dans RECAP_WORKDIR, lu par Claude puis par l'envoi. */
export const CANDIDATES_FILE = 'candidates.json';
/** Sortie structurée de Claude, extraite par le workflow. */
export const BRIEF_FILE = 'brief.json';

/** Un article proposé à Claude (fichier candidates.json). */
export interface Candidate {
  /** Identifiant court (a1, a2…) pour s'y référer dans la consigne. */
  id: string;
  title: string;
  url: string;
  source: string;
  lang: 'fr' | 'en' | null;
  publishedAt: string | null;
  excerpt: string;
}

const LANG_BY_LABEL = new Map(Object.values(NEWS_SOURCES).map(s => [s.label, s.lang]));

/** NewsItem → Candidate, extrait raboté à la phrase. Pur, exporté pour tests. */
export function toCandidates(items: NewsItem[]): Candidate[] {
  return items.map((it, i) => ({
    id: `a${i + 1}`,
    title: it.title,
    url: it.url,
    source: it.source,
    lang: LANG_BY_LABEL.get(it.source) ?? null,
    publishedAt: it.publishedAt ?? null,
    excerpt: it.excerpt ? cutAtSentence(it.excerpt, 600) : '',
  }));
}

/** Agrège les sources sur la fenêtre et renvoie les candidats, plus récents d'abord. */
export async function collectCandidates(opts: {
  sourceIds: string[];
  sinceHours: number;
  limit: number;
}): Promise<{ candidates: Candidate[]; failed: string[]; totalFetched: number }> {
  const res = await aggregateNews({
    sources: opts.sourceIds,
    sinceHours: opts.sinceHours,
    limit: opts.limit,
  });
  return {
    candidates: toCandidates(res.items),
    failed: res.failed,
    totalFetched: res.totalFetched,
  };
}
