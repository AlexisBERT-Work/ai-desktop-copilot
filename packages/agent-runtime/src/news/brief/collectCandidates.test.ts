import { describe, expect, it } from 'vitest';
import { toCandidates } from './collectCandidates';

describe('toCandidates', () => {
  it('numérote, rabote l’extrait, renseigne la langue de la source', () => {
    const [c] = toCandidates([
      {
        title: 'Titre',
        url: 'https://www.actuia.com/x',
        source: 'ActuIA',
        excerpt: 'Une phrase. '.repeat(80),
      },
    ]);
    expect(c).toMatchObject({ id: 'a1', lang: 'fr', publishedAt: null });
    expect(c).not.toHaveProperty('image');
    expect(c!.excerpt.length).toBeLessThanOrEqual(601);
  });

  it('langue inconnue pour une source hors catalogue', () => {
    const [c] = toCandidates([{ title: 'T', url: 'https://ex.com', source: 'ex.com' }]);
    expect(c).toMatchObject({ lang: null, excerpt: '' });
  });
});
