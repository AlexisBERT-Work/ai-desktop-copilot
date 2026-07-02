import type { PressFeed } from '@catdesk/shared-types';
import type { OllamaClient } from '../llm/OllamaClient';
import { aggregateNews, filterByRegex, type NewsItem } from '../tools/web/FetchTechNewsTool';
import { enrichExcerpts } from '../tools/web/PostTechNewsDiscordTool';
import { analyzeJournal, buildJournalBody, journalTitle, type JournalDraft } from './pressDigest';
import { createLogger } from '../logger';

const log = createLogger('news:custom-journal');

export interface CustomJournalDeps {
  llm: OllamaClient;
  model: string;
  now?: Date;
}

/** Taille du vivier agrégé avant filtre regex (marge pour l'exclusion), plafonné. */
export function poolLimit(articleLimit: number): number {
  return Math.min(200, Math.max(articleLimit, articleLimit * 3));
}

/**
 * Construit la daily d'UN journal personnalisé : agrège ses sources + URLs de
 * flux, applique le filtre par mots-clés (dans aggregateNews) puis le filtre
 * regex inclure/exclure, en garde les plus importants, et demande au LLM une
 * analyse intra-journal. Renvoie null si aucun article ne survit (rien à publier).
 */
export async function buildCustomJournalDaily(
  feed: PressFeed,
  deps: CustomJournalDeps,
): Promise<JournalDraft | null> {
  const now = deps.now ?? new Date();

  let items: NewsItem[] = [];
  try {
    const res = await aggregateNews({
      sources: feed.sourceIds,
      feeds: feed.feedUrls,
      topics: feed.includeKeywords,
      sinceHours: feed.sinceHours,
      limit: poolLimit(feed.articleLimit),
    });
    items = res.items;
  } catch (err) {
    log.warn('Custom journal fetch failed — skipped', { name: feed.name, error: String(err) });
    return null;
  }

  items = filterByRegex(items, feed.includeRegex, feed.excludeRegex).slice(0, feed.articleLimit);
  if (items.length === 0) {
    log.info('Custom journal produced no articles', { name: feed.name });
    return null;
  }

  await enrichExcerpts(items);
  const { analysis, summaries } = await analyzeJournal(deps.llm, deps.model, feed.name, items);

  return {
    journal: feed.name,
    category: feed.category,
    title: journalTitle(feed.name, now),
    body: buildJournalBody(analysis, items, summaries),
  };
}

/** Construit une daily par journal personnalisé actif. Les journaux vides sont ignorés. */
export async function buildCustomJournalDailies(
  feeds: PressFeed[],
  deps: CustomJournalDeps,
): Promise<JournalDraft[]> {
  const drafts: JournalDraft[] = [];
  for (const feed of feeds) {
    if (!feed.enabled) continue;
    const draft = await buildCustomJournalDaily(feed, deps);
    if (draft !== null) drafts.push(draft);
  }
  log.info('Custom journal dailies built', { journals: drafts.length, requested: feeds.length });
  return drafts;
}
