import { runPressDigest as apiRunPressDigest } from '../../shared/api/press';
import {
  isDailyCategory,
  type DailyCategory,
  type PressFeed,
  type PressFeedInput,
} from '@catdesk/shared-types';
import { makeTableCrud } from '../news/supabaseCrud';

interface PressFeedRow {
  id: string;
  name: string;
  category: string;
  source_ids: string[] | null;
  feed_urls: string[] | null;
  include_keywords: string[] | null;
  include_regex: string | null;
  exclude_regex: string | null;
  since_hours: number;
  article_limit: number;
  enabled: boolean;
}

function asCategory(x: string): DailyCategory {
  return isDailyCategory(x) ? x : 'misc';
}

function rowToPressFeed(r: PressFeedRow): PressFeed {
  return {
    id: r.id,
    name: r.name,
    category: asCategory(r.category),
    sourceIds: r.source_ids ?? [],
    feedUrls: r.feed_urls ?? [],
    includeKeywords: r.include_keywords ?? [],
    includeRegex: r.include_regex,
    excludeRegex: r.exclude_regex,
    sinceHours: r.since_hours,
    articleLimit: r.article_limit,
    enabled: r.enabled,
  };
}

/** Colonnes DB (snake_case) à écrire depuis une saisie. */
function inputToRow(input: PressFeedInput) {
  return {
    name: input.name,
    category: input.category,
    source_ids: input.sourceIds,
    feed_urls: input.feedUrls,
    include_keywords: input.includeKeywords,
    include_regex: input.includeRegex,
    exclude_regex: input.excludeRegex,
    since_hours: input.sinceHours,
    article_limit: input.articleLimit,
    enabled: input.enabled,
  };
}

const crud = makeTableCrud<PressFeedRow, PressFeed, PressFeedInput>({
  table: 'press_feeds',
  toModel: rowToPressFeed,
  toRow: inputToRow,
  orderBy: 'created_at',
  updateExtra: () => ({ updated_at: new Date().toISOString() }),
});

export const listPressFeeds = crud.listAll;
export const createPressFeed = crud.create;
export const updatePressFeed = crud.update;
export const deletePressFeed = crud.remove;

/**
 * Déclenche une publication immédiate de la revue de presse (journaux perso
 * inclus) sur le poste admin. Fire-and-forget côté agent : les dailys arrivent
 * ensuite via Realtime. Sans effet sur un poste sans identifiants admin.
 */
export async function runPressDigestNow(): Promise<{ error: string | null }> {
  try {
    await apiRunPressDigest();
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
