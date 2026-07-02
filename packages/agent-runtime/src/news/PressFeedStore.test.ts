import { describe, it, expect } from 'vitest';
import { rowToPressFeed } from './PressFeedStore';
import { poolLimit } from './customJournalDigest';

describe('rowToPressFeed', () => {
  it('convertit une ligne complète', () => {
    const feed = rowToPressFeed({
      id: 'abc',
      name: 'Le Monde · IA',
      category: 'tech',
      source_ids: ['lemonde'],
      feed_urls: ['https://x/rss'],
      include_keywords: ['IA'],
      include_regex: '(IA|LLM)',
      exclude_regex: 'sponsoris',
      since_hours: 48,
      article_limit: 20,
      enabled: true,
    });
    expect(feed).toEqual({
      id: 'abc',
      name: 'Le Monde · IA',
      category: 'tech',
      sourceIds: ['lemonde'],
      feedUrls: ['https://x/rss'],
      includeKeywords: ['IA'],
      includeRegex: '(IA|LLM)',
      excludeRegex: 'sponsoris',
      sinceHours: 48,
      articleLimit: 20,
      enabled: true,
    });
  });

  it('rejette une ligne sans id ou sans nom', () => {
    expect(rowToPressFeed({ name: 'x' })).toBeNull();
    expect(rowToPressFeed({ id: 'a', name: '  ' })).toBeNull();
  });

  it('applique des défauts tolérants (catégorie inconnue, listes absentes, regex vide)', () => {
    const feed = rowToPressFeed({ id: 'a', name: 'Test', category: 'zzz', include_regex: '' });
    expect(feed).not.toBeNull();
    expect(feed!.category).toBe('misc');
    expect(feed!.sourceIds).toEqual([]);
    expect(feed!.feedUrls).toEqual([]);
    expect(feed!.includeRegex).toBeNull();
    expect(feed!.sinceHours).toBe(24);
    expect(feed!.articleLimit).toBe(12);
    expect(feed!.enabled).toBe(true);
  });

  it('traite enabled=false explicitement', () => {
    expect(rowToPressFeed({ id: 'a', name: 'T', enabled: false })!.enabled).toBe(false);
  });
});

describe('poolLimit', () => {
  it('agrège un vivier plus large que la limite finale (marge pour exclusion)', () => {
    expect(poolLimit(12)).toBe(36);
    expect(poolLimit(1)).toBe(3);
  });

  it('plafonne à 200', () => {
    expect(poolLimit(100)).toBe(200);
  });
});
