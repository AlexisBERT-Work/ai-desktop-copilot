import type { PressFeed } from '@catdesk/shared-types';
import type { OllamaClient } from '../llm/OllamaClient';
import { aggregateNews, filterByRegex, type NewsItem } from '../tools/web/FetchTechNewsTool';
import { enrichArticleTexts } from '../tools/web/PostTechNewsDiscordTool';
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
  let failed: string[] = [];
  let totalFetched = 0;
  try {
    const res = await aggregateNews({
      sources: feed.sourceIds,
      feeds: feed.feedUrls,
      topics: feed.includeKeywords,
      includeRegex: feed.includeRegex,
      excludeRegex: feed.excludeRegex,
      sinceHours: feed.sinceHours,
      limit: poolLimit(feed.articleLimit),
    });
    items = res.items;
    failed = res.failed;
    totalFetched = res.totalFetched;
  } catch (err) {
    log.warn('Custom journal fetch failed — skipped', { name: feed.name, error: String(err) });
    return null;
  }

  items = filterByRegex(items, feed.includeRegex, feed.excludeRegex).slice(0, feed.articleLimit);
  if (items.length === 0) {
    // Les échecs par source d'aggregateNews sont collectés, pas lancés — les
    // logguer ici est le seul moyen de distinguer « flux muet », « tout filtré »
    // et « fetch raté ».
    log.info('Custom journal produced no articles', { name: feed.name, totalFetched, failed });
    return null;
  }

  await enrichArticleTexts(items);
  const { analysis, summaries, details } = await analyzeJournal(deps.llm, deps.model, feed.name, items);

  return {
    journal: feed.name,
    category: feed.category,
    title: journalTitle(feed.name, now),
    body: buildJournalBody(analysis, items, summaries, details),
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
