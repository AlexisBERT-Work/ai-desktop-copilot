import { describe, expect, it } from 'vitest';
import { BRIEF_FIXTURE } from '../brief/briefFixture';
import {
  FIL_LIMITS,
  briefToCards,
  cardId,
  httpsOrNull,
  leadParagraph,
  makeCard,
  parisDay,
} from './filCards';

const DAY = '2026-11-08';

describe('briefToCards', () => {
  const cards = briefToCards(BRIEF_FIXTURE, DAY);

  it('un sujet à la une, une tendance, une brève : une carte chacun, dans l’ordre du brief', () => {
    expect(cards.map(c => c.kind)).toEqual([
      'news',
      'news',
      'tendance',
      'tendance',
      'breve',
      'breve',
    ]);
    expect(cards.map(c => c.rank)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(cards.every(c => c.day === DAY)).toBe(true);
  });

  it('à la une : résumé court sans gras, faits, contexte et doute au détail', () => {
    const lead = cards[0]!;
    expect(lead.summary).toBe(
      'Le ministère du Commerce vise 23 technologies, dont les poids au-delà de 10^26 FLOPs & plus.',
    );
    expect(lead.details).toContain('les **puces** d’inférence');
    expect(lead.details).toContain('**Contexte**');
    expect(lead.details).toContain('**Pas confirmé** : Date d’entrée en vigueur non publiée.');
    expect(cards[1]!.details).not.toContain('Pas confirmé');
  });

  it('liens : https seulement, la source primaire signalée', () => {
    const lead = cards[0]!;
    expect(lead.url).toBe('https://mofcom.gov.cn/a');
    expect(lead.source).toBe('MOFCOM');
    expect(lead.links).toEqual([
      { label: 'MOFCOM (source primaire)', url: 'https://mofcom.gov.cn/a' },
      { label: 'The Decoder', url: 'https://the-decoder.com/a' },
    ]);
  });

  it('tendance et brève : la rubrique ou le type de tendance dans la source', () => {
    expect(cards[2]!.source).toBe('Benchmarks · LMArena');
    expect(cards[4]!).toMatchObject({
      title: 'Anthropic durcit l’anti-distillation',
      summary: 'Tokens extraits réduits de 90 à 99 %.',
      source: 'Sécurité · ActuIA',
      details: null,
    });
  });

  it('republier le même brief donne les mêmes identifiants', () => {
    expect(briefToCards(BRIEF_FIXTURE, DAY).map(c => c.id)).toEqual(cards.map(c => c.id));
    expect(new Set(cards.map(c => c.id)).size).toBe(cards.length);
  });
});

describe('makeCard', () => {
  const base = { kind: 'breve' as const, day: DAY, rank: 0, title: 'Titre', summary: 'Résumé.' };

  it('borne les longueurs de la table', () => {
    const card = makeCard({ ...base, title: 'Mot '.repeat(100), summary: 'Phrase. '.repeat(200) });
    expect(card.title.length).toBeLessThanOrEqual(FIL_LIMITS.title);
    expect(card.summary.length).toBeLessThanOrEqual(FIL_LIMITS.summary);
  });

  it('écarte une URL qui n’est pas en https, et plafonne les liens', () => {
    const card = makeCard({
      ...base,
      url: 'http://ex.com',
      links: Array.from({ length: 6 }, (_, i) => ({ label: `L${i}`, url: `https://ex.com/${i}` })),
    });
    expect(card.url).toBeNull();
    expect(card.links).toHaveLength(FIL_LIMITS.links);
  });

  it('l’identifiant est un sha1 hexadécimal', () => {
    expect(makeCard(base).id).toMatch(/^[0-9a-f]{40}$/);
    expect(cardId('breve', null, 'Titre')).toBe(makeCard(base).id);
  });
});

describe('helpers', () => {
  it('httpsOrNull', () => {
    expect(httpsOrNull(' https://ex.com/a ')).toBe('https://ex.com/a');
    expect(httpsOrNull('javascript:alert(1)')).toBeNull();
    expect(httpsOrNull('https://')).toBeNull();
    expect(httpsOrNull(null)).toBeNull();
  });

  it('leadParagraph : premier paragraphe, coupé proprement', () => {
    expect(leadParagraph('Un **fait**.\n\nUn autre.')).toBe('Un fait.');
    expect(leadParagraph(`${'Phrase longue. '.repeat(40)}`).length).toBeLessThanOrEqual(280);
  });

  it('parisDay : le jour de Paris, pas celui d’UTC', () => {
    expect(parisDay(new Date('2026-11-07T23:30:00Z'))).toBe('2026-11-08');
    expect(parisDay(new Date('2026-11-08T04:50:00Z'))).toBe('2026-11-08');
  });
});
