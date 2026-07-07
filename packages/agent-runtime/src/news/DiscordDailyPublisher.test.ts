import { describe, it, expect } from 'vitest';
import { batchEmbeds, chunk, draftToEmbed, dailyHeader, embedSize, stripDetails } from './DiscordDailyPublisher';
import type { DiscordEmbed } from '../tools/web/PostTechNewsDiscordTool';
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

function embed(size: number): DiscordEmbed {
  return { title: 'T', color: 0, description: 'x'.repeat(Math.max(0, size - 1)) };
}

describe('batchEmbeds', () => {
  it('garde un lot unique sous les deux limites', () => {
    expect(batchEmbeds([embed(1000), embed(1000)])).toHaveLength(1);
  });

  it('coupe quand le cumul dépasserait 6000 caractères', () => {
    // 3 × 2500 = 7500 > 6000 ⇒ [2 embeds (5000), 1 embed] — le cas exact du 400
    // « Embed size exceeds maximum size of 6000 » renvoyé par Discord.
    const batches = batchEmbeds([embed(2500), embed(2500), embed(2500)]);
    expect(batches.map((b) => b.length)).toEqual([2, 1]);
  });

  it('coupe aussi à 10 embeds même petits', () => {
    const batches = batchEmbeds(Array.from({ length: 12 }, () => embed(10)));
    expect(batches.map((b) => b.length)).toEqual([10, 2]);
  });

  it('un embed trop gros à lui seul part dans son propre lot', () => {
    const batches = batchEmbeds([embed(5000), embed(4500)]);
    expect(batches.map((b) => b.length)).toEqual([1, 1]);
  });

  it('retourne vide pour une entrée vide', () => {
    expect(batchEmbeds([])).toEqual([]);
  });
});

describe('embedSize', () => {
  it('compte titre + description + footer', () => {
    expect(embedSize({ title: 'ab', color: 0, description: 'cde', footer: { text: 'fg' } })).toBe(7);
    expect(embedSize({ title: 'ab', color: 0 })).toBe(2);
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

  it('retire les blockquotes de détail du corps publié', () => {
    const body = 'Analyse.\n\n- [A](https://x/a) — résumé\n  > Long détail réservé à l’app.';
    const embed = draftToEmbed(draft({ body }));
    expect(embed.description).toContain('- [A](https://x/a) — résumé');
    expect(embed.description).not.toContain('Long détail');
  });
});

describe('stripDetails', () => {
  it('supprime les lignes blockquote (indentées ou non) et garde le reste', () => {
    const md = 'Analyse.\n> détail racine\n- puce\n  > détail imbriqué\n- autre puce';
    expect(stripDetails(md)).toBe('Analyse.\n- puce\n- autre puce');
  });

  it('laisse intact un corps sans détails', () => {
    const md = 'Analyse.\n\n- [A](https://x/a) — résumé';
    expect(stripDetails(md)).toBe(md);
  });
});

describe('dailyHeader', () => {
  it('pluralises the briefing count', () => {
    expect(dailyHeader(1)).toContain('1 briefing');
    expect(dailyHeader(3)).toContain('3 briefings');
  });
});
