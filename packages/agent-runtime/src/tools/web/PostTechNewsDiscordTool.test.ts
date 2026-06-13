import { describe, it, expect } from 'vitest';
import { buildDiscordEmbeds, relativeAge } from './PostTechNewsDiscordTool';
import type { NewsItem } from './FetchTechNewsTool';

describe('relativeAge', () => {
  const now = Date.parse('2025-06-10T12:00:00Z');

  it('formate minutes, heures et jours', () => {
    expect(relativeAge('2025-06-10T11:30:00Z', now)).toBe('il y a 30 min');
    expect(relativeAge('2025-06-10T08:00:00Z', now)).toBe('il y a 4 h');
    expect(relativeAge('2025-06-08T12:00:00Z', now)).toBe('il y a 2 j');
  });

  it('renvoie null si date absente ou invalide', () => {
    expect(relativeAge(undefined, now)).toBeNull();
    expect(relativeAge('pas une date', now)).toBeNull();
  });
});

describe('buildDiscordEmbeds', () => {
  const now = Date.parse('2025-06-10T12:00:00Z');

  it('construit un embed cliquable avec métadonnées', () => {
    const items: NewsItem[] = [
      { title: 'GPT-5 sort', url: 'https://x/1', source: 'Hacker News', points: 120, comments: 45, publishedAt: '2025-06-10T08:00:00Z' },
    ];
    const [embed] = buildDiscordEmbeds(items, [], now);
    expect(embed!.title).toBe('GPT-5 sort');
    expect(embed!.url).toBe('https://x/1');
    expect(embed!.footer).toEqual({ text: 'Hacker News' });
    expect(embed!.description).toContain('▲ 120');
    expect(embed!.description).toContain('💬 45');
    expect(embed!.description).toContain('il y a 4 h');
    expect(embed!.timestamp).toBe('2025-06-10T08:00:00.000Z');
  });

  it('place le résumé en tête de description, devant les métadonnées', () => {
    const items: NewsItem[] = [
      { title: 'GPT-5 sort', url: 'https://x/1', source: 'Hacker News', points: 120 },
    ];
    const [embed] = buildDiscordEmbeds(items, ['OpenAI dévoile GPT-5 avec un raisonnement amélioré.'], now);
    expect(embed!.description!.startsWith('OpenAI dévoile GPT-5')).toBe(true);
    expect(embed!.description).toContain('▲ 120');
  });

  it('plafonne à 10 embeds (limite Discord)', () => {
    const items: NewsItem[] = Array.from({ length: 15 }, (_, i) => ({
      title: `Article ${i}`,
      url: `https://x/${i}`,
      source: 'Test',
    }));
    expect(buildDiscordEmbeds(items, [], now)).toHaveLength(10);
  });

  it('tronque les titres trop longs à 256 caractères', () => {
    const items: NewsItem[] = [{ title: 'A'.repeat(300), url: 'https://x/1', source: 'Test' }];
    const [embed] = buildDiscordEmbeds(items, [], now);
    expect(embed!.title.length).toBe(256);
    expect(embed!.title.endsWith('…')).toBe(true);
  });

  it('omet description et timestamp quand aucune métadonnée ni résumé', () => {
    const items: NewsItem[] = [{ title: 'Sans méta', url: 'https://x/1', source: 'Test' }];
    const [embed] = buildDiscordEmbeds(items, [], now);
    expect(embed!.description).toBeUndefined();
    expect(embed!.timestamp).toBeUndefined();
  });
});
