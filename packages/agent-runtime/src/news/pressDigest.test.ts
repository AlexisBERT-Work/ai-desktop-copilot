import { describe, it, expect } from 'vitest';
import {
  buildGlobalBody,
  buildGlobalPrompt,
  buildJournalBody,
  buildJournalPrompt,
  globalTitle,
  journalTitle,
  parseAnalysisJson,
  parseSynthesisJson,
} from './pressDigest';
import { dayKey, isRunDue } from './PressDigestScheduler';
import type { NewsItem } from '../tools/web/FetchTechNewsTool';

function item(title: string, url: string, excerpt?: string): NewsItem {
  return { title, url, source: 'Le Monde', ...(excerpt !== undefined ? { excerpt } : {}) };
}

const items: NewsItem[] = [
  item('Titre A', 'https://x/a', 'Extrait A'),
  item('Titre B', 'https://x/b'),
];

describe('buildJournalPrompt', () => {
  it('liste le journal, le nombre et les titres', () => {
    const p = buildJournalPrompt('Le Monde', items);
    expect(p).toContain('Journal : Le Monde');
    expect(p).toContain('les 2 articles');
    expect(p).toContain('Titre A');
    expect(p).toContain('Extrait : Extrait A');
    expect(p).toContain('Titre B');
  });
});

describe('parseAnalysisJson', () => {
  it('parse un JSON propre', () => {
    expect(parseAnalysisJson('{"analyse":"Tendance X","resumes":["r1","r2"]}')).toEqual({
      analysis: 'Tendance X',
      summaries: ['r1', 'r2'],
    });
  });

  it('tolère les fences markdown et le texte autour', () => {
    const raw = 'Voici:\n```json\n{"analyse":"A","resumes":["r1"]}\n```\nFin.';
    expect(parseAnalysisJson(raw)).toEqual({ analysis: 'A', summaries: ['r1'] });
  });

  it('renvoie null si illisible ou vide', () => {
    expect(parseAnalysisJson('pas de json')).toBeNull();
    expect(parseAnalysisJson('{"analyse":"","resumes":[]}')).toBeNull();
  });
});

describe('journalTitle', () => {
  it('inclut le journal et la date', () => {
    const t = journalTitle('Le Monde', new Date('2026-06-30T08:00:00'));
    expect(t).toContain('Le Monde — revue du');
    expect(t).toContain('30');
  });
});

describe('buildJournalBody', () => {
  it('compose analyse + liste de liens avec résumés', () => {
    const body = buildJournalBody('Analyse du jour.', items, ['résumé A', '']);
    expect(body).toContain('Analyse du jour.');
    expect(body).toContain('- [Titre A](https://x/a) — résumé A');
    // Pas de résumé pour B → lien seul, sans tiret de fin.
    expect(body).toContain('- [Titre B](https://x/b)');
    expect(body).not.toContain('Titre B) —');
  });

  it('omet le bloc analyse si vide', () => {
    const body = buildJournalBody('', [item('T', 'https://x/t')], ['']);
    expect(body.startsWith('- [T]')).toBe(true);
  });
});

describe('synthèse transversale', () => {
  const entries = [
    { journal: 'Le Monde', analysis: 'Focus climat.' },
    { journal: 'BBC', analysis: 'Focus géopolitique.' },
  ];

  it('buildGlobalPrompt liste les journaux et analyses', () => {
    const p = buildGlobalPrompt(entries);
    expect(p).toContain('- Le Monde : Focus climat.');
    expect(p).toContain('- BBC : Focus géopolitique.');
  });

  it('parseSynthesisJson lit la synthèse, null si vide/illisible', () => {
    expect(parseSynthesisJson('{"synthese":"Tendance globale"}')).toBe('Tendance globale');
    expect(parseSynthesisJson('{"synthese":""}')).toBeNull();
    expect(parseSynthesisJson('rien')).toBeNull();
  });

  it('globalTitle est daté', () => {
    expect(globalTitle(new Date('2026-06-30T08:00:00'))).toContain('Synthèse du jour —');
  });

  it('buildGlobalBody ajoute les journaux couverts', () => {
    const body = buildGlobalBody('Synthèse X.', ['Le Monde', 'BBC']);
    expect(body).toContain('Synthèse X.');
    expect(body).toContain('Journaux couverts : Le Monde, BBC');
  });
});

describe('isRunDue', () => {
  it('pas dû avant l’heure de publication', () => {
    expect(isRunDue(7, null, new Date('2026-06-30T06:00:00'))).toBe(false);
  });

  it('dû dès l’heure atteinte si rien n’a tourné aujourd’hui', () => {
    expect(isRunDue(7, null, new Date('2026-06-30T07:00:00'))).toBe(true);
  });

  it('rattrapage : dû même bien après l’heure (démarrage tardif du PC)', () => {
    expect(isRunDue(7, null, new Date('2026-06-30T18:30:00'))).toBe(true);
  });

  it('dû si le dernier run réussi date d’hier', () => {
    const yesterday = dayKey(new Date('2026-06-29T09:00:00'));
    expect(isRunDue(7, yesterday, new Date('2026-06-30T08:00:00'))).toBe(true);
  });

  it('pas dû une seconde fois le même jour', () => {
    const today = dayKey(new Date('2026-06-30T07:05:00'));
    expect(isRunDue(7, today, new Date('2026-06-30T22:00:00'))).toBe(false);
  });
});
