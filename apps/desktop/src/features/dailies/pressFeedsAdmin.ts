import { invoke } from '@tauri-apps/api/core';
import {
  isDailyCategory,
  type DailyCategory,
  type PressFeed,
  type PressFeedInput,
} from '@catdesk/shared-types';
import { supabase } from '../news/supabaseClient';

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

const NOT_CONFIGURED = 'Supabase non configuré.';

export async function listPressFeeds(): Promise<{ items: PressFeed[]; error: string | null }> {
  if (supabase === null) return { items: [], error: NOT_CONFIGURED };
  const { data, error } = await supabase
    .from('press_feeds')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return { items: [], error: error.message };
  return { items: ((data ?? []) as PressFeedRow[]).map(rowToPressFeed), error: null };
}

export async function createPressFeed(input: PressFeedInput): Promise<{ error: string | null }> {
  if (supabase === null) return { error: NOT_CONFIGURED };
  const { error } = await supabase.from('press_feeds').insert(inputToRow(input));
  return { error: error?.message ?? null };
}

export async function updatePressFeed(
  id: string,
  input: PressFeedInput,
): Promise<{ error: string | null }> {
  if (supabase === null) return { error: NOT_CONFIGURED };
  const { error } = await supabase
    .from('press_feeds')
    .update({ ...inputToRow(input), updated_at: new Date().toISOString() })
    .eq('id', id);
  return { error: error?.message ?? null };
}

export async function deletePressFeed(id: string): Promise<{ error: string | null }> {
  if (supabase === null) return { error: NOT_CONFIGURED };
  const { error } = await supabase.from('press_feeds').delete().eq('id', id);
  return { error: error?.message ?? null };
}

/**
 * Déclenche une publication immédiate de la revue de presse (journaux perso
 * inclus) sur le poste admin. Fire-and-forget côté agent : les dailys arrivent
 * ensuite via Realtime. Sans effet sur un poste sans identifiants admin.
 */
export async function runPressDigestNow(): Promise<{ error: string | null }> {
  try {
    await invoke('run_press_digest');
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
