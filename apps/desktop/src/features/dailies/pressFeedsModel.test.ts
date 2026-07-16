import { describe, expect, it } from 'vitest';
import { EMPTY_PRESS_FEED, type PressFeed } from '@catdesk/shared-types';
import {
  csv,
  lines,
  draftToInput,
  feedToDraft,
  fold,
  regexError,
  sourceSummary,
  EMPTY_DRAFT,
} from './pressFeedsModel';

describe('parsing des champs texte', () => {
  it('csv découpe, trim et ignore les vides', () => {
    expect(csv(' ia,  bourse ,, tech ')).toEqual(['ia', 'bourse', 'tech']);
    expect(csv('')).toEqual([]);
  });

  it('lines découpe par ligne (CRLF inclus) et ignore les vides', () => {
    expect(lines('https://a.fr/rss\r\n\n  https://b.fr/rss  \n')).toEqual([
      'https://a.fr/rss',
      'https://b.fr/rss',
    ]);
  });
});

describe('regexError', () => {
  it('null pour un motif vide ou valide', () => {
    expect(regexError('')).toBeNull();
    expect(regexError('  ')).toBeNull();
    expect(regexError('(ia|llm)')).toBeNull();
  });

  it('message pour un motif invalide', () => {
    expect(regexError('(oops')).not.toBeNull();
  });
});

describe('brouillon ↔ modèle', () => {
  const feed: PressFeed = {
    ...EMPTY_PRESS_FEED,
    id: 'f1',
    name: 'Mon journal',
    category: 'tech',
    sourceIds: ['lemonde'],
    feedUrls: ['https://a.fr/rss', 'https://b.fr/rss'],
    includeKeywords: ['ia', 'llm'],
    includeRegex: 'gpu',
    excludeRegex: null,
    enabled: true,
  };

  it('feedToDraft → draftToInput est un aller-retour fidèle', () => {
    const draft = feedToDraft(feed);
    expect(draft.feedUrls).toBe('https://a.fr/rss\nhttps://b.fr/rss');
    expect(draft.includeKeywords).toBe('ia, llm');

    const input = draftToInput(draft);
    expect(input.name).toBe('Mon journal');
    expect(input.feedUrls).toEqual(feed.feedUrls);
    expect(input.includeKeywords).toEqual(feed.includeKeywords);
    expect(input.includeRegex).toBe('gpu');
    expect(input.excludeRegex).toBeNull();
  });

  it('draftToInput normalise : trim du nom, regex vide → null', () => {
    const input = draftToInput({ ...EMPTY_DRAFT, name: '  X  ', includeRegex: '   ' });
    expect(input.name).toBe('X');
    expect(input.includeRegex).toBeNull();
  });
});

describe("helpers d'affichage", () => {
  it('fold retire accents et casse', () => {
    expect(fold('Libération')).toBe('liberation');
  });

  it('sourceSummary liste labels + flux perso, ou « aucune source »', () => {
    const f: PressFeed = { ...EMPTY_PRESS_FEED, id: 'f0', sourceIds: [], feedUrls: [] };
    expect(sourceSummary(f)).toBe('aucune source');
    const g: PressFeed = {
      ...EMPTY_PRESS_FEED,
      id: 'f1',
      sourceIds: ['id-inconnu'],
      feedUrls: ['u1', 'u2'],
    };
    expect(sourceSummary(g)).toBe('id-inconnu, 2 flux perso');
  });
});
