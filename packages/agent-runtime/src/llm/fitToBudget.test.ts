import { describe, expect, it } from 'vitest';
import { textTokens } from './contextBudget';
import { fitToBudget } from './fitToBudget';

const tokensOf = (v: unknown): number => textTokens(JSON.stringify(v));
const prose = (words: number): string =>
  Array.from({ length: words }, (_, i) => `mot${String.fromCharCode(97 + (i % 26))}`).join(' ');

describe('fitToBudget', () => {
  it('rend la sortie telle quelle quand elle tient', () => {
    const data = { title: 'Rapport', text: 'court' };
    const fitted = fitToBudget(data, 500);
    expect(fitted.cut).toBe(false);
    expect(fitted.data).toBe(data);
  });

  it('coupe la fin d’un long texte, marque la coupe et tient dans le budget', () => {
    const text = `DÉBUT ${prose(6000)} FIN`;
    const fitted = fitToBudget({ format: 'pdf', text }, 1000);
    const data = fitted.data as { format: string; text: string };

    expect(fitted.cut).toBe(true);
    expect(fitted.tokens).toBeLessThanOrEqual(1000);
    expect(tokensOf(data)).toBe(fitted.tokens);
    expect(data.format).toBe('pdf');
    expect(data.text.startsWith('DÉBUT')).toBe(true);
    expect(data.text).not.toContain('FIN');
    expect(data.text).toMatch(/\[coupé : \d+ caractères sur \d+\]$/);
  });

  it('garde les textes courts entiers et raccourcit les longs', () => {
    const fitted = fitToBudget(
      { titre: 'Résultats trimestriels', resume: prose(40), corps: prose(5000) },
      800,
    );
    const data = fitted.data as Record<string, string>;
    expect(data.titre).toBe('Résultats trimestriels');
    expect(data.resume).toBe(prose(40));
    expect(data.corps).toContain('[coupé');
    expect(fitted.tokens).toBeLessThanOrEqual(800);
  });

  it('raccourcit une longue liste par la fin et dit combien d’éléments manquent', () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({
      ligne: i + 1,
      ville: 'Lyon',
      prix: 1234.5,
    }));
    const fitted = fitToBudget({ headers: ['ligne', 'ville', 'prix'], rows }, 600);
    const data = fitted.data as { headers: string[]; rows: unknown[] };

    expect(fitted.tokens).toBeLessThanOrEqual(600);
    expect(data.headers).toEqual(['ligne', 'ville', 'prix']);
    expect(data.rows[0]).toEqual({ ligne: 1, ville: 'Lyon', prix: 1234.5 });
    expect(data.rows.at(-1)).toMatch(/^… \[\d+ éléments coupés\]$/);
  });

  it('préfère raccourcir les textes de chaque élément plutôt que d’en retirer', () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ id: i, body: prose(800) }));
    const fitted = fitToBudget({ items }, 1500);
    const data = fitted.data as { items: Array<{ id: number; body: string }> };
    expect(data.items).toHaveLength(5);
    expect(data.items.every(it => it.body.includes('[coupé'))).toBe(true);
  });

  it('filet : un objet à mille petites clés est tranché, mais tient', () => {
    const data: Record<string, number> = {};
    for (let i = 0; i < 3000; i++) data[`k${i}`] = i;
    const fitted = fitToBudget(data, 400);
    expect(fitted.cut).toBe(true);
    expect(fitted.tokens).toBeLessThanOrEqual(400);
    expect(fitted.data).toHaveProperty('sortieTronquee');
  });

  it('envoie du JSON pur : une date devient sa chaîne', () => {
    const fitted = fitToBudget({ when: new Date('2026-11-21T10:00:00Z'), text: prose(3000) }, 500);
    expect((fitted.data as { when: unknown }).when).toBe('2026-11-21T10:00:00.000Z');
  });
});
