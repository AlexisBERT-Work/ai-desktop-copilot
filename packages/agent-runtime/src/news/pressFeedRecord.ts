import { isDailyCategory, type PressFeed } from '@catdesk/shared-types';

// Lecture tolérante d'un journal personnalisé depuis un enregistrement non
// fiable. Deux sources, même forme à la casse près : le fichier local
// (camelCase, LocalPressFeedStore) et la table Supabase `press_feeds`
// (snake_case, PressFeedStore). Les deux conversions étaient recopiées champ
// par champ, avec leurs trois coercitions.

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : [];
}

function asPositiveInt(x: unknown, fallback: number): number {
  const n = typeof x === 'number' ? x : Number(x);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function asOptionalPattern(x: unknown): string | null {
  return typeof x === 'string' && x.length > 0 ? x : null;
}

const SNAKE: Record<string, string> = {
  sourceIds: 'source_ids',
  feedUrls: 'feed_urls',
  includeKeywords: 'include_keywords',
  includeRegex: 'include_regex',
  excludeRegex: 'exclude_regex',
  sinceHours: 'since_hours',
  articleLimit: 'article_limit',
};

/**
 * Convertit un enregistrement en PressFeed, ou null s'il n'a ni id ni nom.
 * Tout champ absent ou invalide prend sa valeur par défaut. Pur.
 */
export function pressFeedFromRecord(
  r: Record<string, unknown>,
  casing: 'camel' | 'snake',
): PressFeed | null {
  const get = (camelKey: string): unknown =>
    r[casing === 'snake' ? (SNAKE[camelKey] ?? camelKey) : camelKey];

  const id = typeof r['id'] === 'string' && r['id'].length > 0 ? r['id'] : null;
  const name = typeof r['name'] === 'string' ? r['name'].trim() : '';
  if (id === null || name.length === 0) return null;
  const category = r['category'];
  return {
    id,
    name,
    category: isDailyCategory(category) ? category : 'misc',
    sourceIds: asStringArray(get('sourceIds')),
    feedUrls: asStringArray(get('feedUrls')),
    includeKeywords: asStringArray(get('includeKeywords')),
    includeRegex: asOptionalPattern(get('includeRegex')),
    excludeRegex: asOptionalPattern(get('excludeRegex')),
    sinceHours: asPositiveInt(get('sinceHours'), 24),
    articleLimit: asPositiveInt(get('articleLimit'), 12),
    enabled: r['enabled'] !== false,
  };
}
