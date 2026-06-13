import { describe, it, expect } from 'vitest';
import { extractDigestJson, buildSummaryPrompt } from './NewsSummarizer';
import type { NewsItem } from '../tools/web/FetchTechNewsTool';

describe('extractDigestJson', () => {
  it('parse un JSON propre', () => {
    const out = extractDigestJson('{"synthese":"Journée IA.","resumes":["A","B"]}');
    expect(out).toEqual({ synthesis: 'Journée IA.', summaries: ['A', 'B'] });
  });

  it('tolère le texte et les fences markdown autour du JSON', () => {
    const raw = 'Voici le résultat :\n```json\n{"synthese":"S","resumes":["x"]}\n```\nVoilà.';
    expect(extractDigestJson(raw)).toEqual({ synthesis: 'S', summaries: ['x'] });
  });

  it('renvoie null si rien de parsable', () => {
    expect(extractDigestJson('pas de json ici')).toBeNull();
    expect(extractDigestJson('{cassé')).toBeNull();
  });

  it('renvoie null si objet vide (ni synthèse ni résumés)', () => {
    expect(extractDigestJson('{"synthese":"","resumes":[]}')).toBeNull();
  });
});

describe('buildSummaryPrompt', () => {
  it('numérote les articles et inclut les extraits', () => {
    const items: NewsItem[] = [
      { title: 'Titre A', url: 'https://x/1', source: 'HN', excerpt: 'extrait A' },
      { title: 'Titre B', url: 'https://x/2', source: 'The Verge' },
    ];
    const prompt = buildSummaryPrompt(items);
    expect(prompt).toContain('2 articles');
    expect(prompt).toContain('Article 1 — Titre A (HN)');
    expect(prompt).toContain('Extrait : extrait A');
    expect(prompt).toContain('Article 2 — Titre B (The Verge)');
  });
});
