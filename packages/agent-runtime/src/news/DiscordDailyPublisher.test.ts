import { describe, it, expect } from 'vitest';
import { chunk, draftToEmbed, dailyHeader } from './DiscordDailyPublisher';
import type { JournalDraft } from './pressDigest';

function draft(over: Partial<JournalDraft> = {}): JournalDraft {
  return {
    journal: 'Le Monde',
    category: 'markets',
    title: 'Le Monde — revue du 1 juillet',
    body: 'Analyse du jour.\n\n- [Titre A](https://x/a) — résumé',
    ...over,
  };
}

describe('chunk', () => {
  it('splits into batches of the given size', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
  it('returns empty for empty input', () => {
    expect(chunk([], 10)).toEqual([]);
  });
});

describe('draftToEmbed', () => {
  it('maps title, body (as description) and category colour/footer', () => {
    const embed = draftToEmbed(draft());
    expect(embed.title).toBe('Le Monde — revue du 1 juillet');
    expect(embed.description).toContain('[Titre A](https://x/a)');
    expect(embed.footer?.text).toBe('Marchés');
    expect(embed.color).toBe(0x16a34a);
    expect(embed.url).toBeUndefined(); // pas d'URL unique pour une daily
  });

  it('omits description when the body is empty', () => {
    const embed = draftToEmbed(draft({ body: '   ' }));
    expect(embed.description).toBeUndefined();
  });

  it('truncates an over-long body to the 4096 limit', () => {
    const embed = draftToEmbed(draft({ body: 'x'.repeat(5000) }));
    expect(embed.description!.length).toBe(4096);
    expect(embed.description!.endsWith('…')).toBe(true);
  });

  it('falls back to blurple for an unknown category', () => {
    const embed = draftToEmbed(draft({ category: 'nope' as JournalDraft['category'] }));
    expect(embed.color).toBe(0x5865f2);
  });
});

describe('dailyHeader', () => {
  it('pluralises the briefing count', () => {
    expect(dailyHeader(1)).toContain('1 briefing');
    expect(dailyHeader(3)).toContain('3 briefings');
  });
});
