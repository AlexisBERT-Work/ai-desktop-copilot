import { describe, it, expect } from 'vitest';
import {
  articleCharBudget,
  buildGlobalBody,
  buildGlobalPrompt,
  buildJournalBody,
  buildJournalPrompt,
  buildVerifyPrompt,
  digitRuns,
  globalTitle,
  journalTitle,
  numbersSupported,
  parseAnalysisJson,
  parseSynthesisJson,
  parseVerifyJson,
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
    expect(p).toContain('Texte : Extrait A');
    expect(p).toContain('Titre B');
  });

  it('préfère le corps téléchargé (fullText) à l’extrait RSS', () => {
    const withBody: NewsItem = { ...item('Titre C', 'https://x/c', 'court extrait'), fullText: 'Corps complet de l’article.' };
    const p = buildJournalPrompt('Le Monde', [withBody]);
    expect(p).toContain('Texte : Corps complet de l’article.');
    expect(p).not.toContain('court extrait');
  });

  it('tronque chaque texte au budget par article', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      ({ ...item(`T${i}`, `https://x/${i}`), fullText: 'x'.repeat(2000) }),
    );
    const p = buildJournalPrompt('Le Monde', many);
    // 20 articles ⇒ 600 caractères chacun (plancher du budget).
    expect(p).toContain('x'.repeat(600));
    expect(p).not.toContain('x'.repeat(601));
  });
});

describe('articleCharBudget', () => {
  it('plafonne à 1500 pour peu d’articles et plancher à 600 pour beaucoup', () => {
    expect(articleCharBudget(1)).toBe(1500);
    expect(articleCharBudget(8)).toBe(1500);
    expect(articleCharBudget(10)).toBe(1200);
    expect(articleCharBudget(30)).toBe(600);
    expect(articleCharBudget(0)).toBe(1500);
  });
});

describe('parseAnalysisJson', () => {
  it('parse un JSON propre', () => {
    expect(parseAnalysisJson('{"analyse":"Tendance X","resumes":["r1","r2"]}')).toEqual({
      analysis: 'Tendance X',
      summaries: ['r1', 'r2'],
      details: [],
    });
  });

  it('parse les détails par article quand présents', () => {
    const raw = '{"analyse":"A","resumes":["r1","r2"],"details":["Long détail 1.",""]}';
    expect(parseAnalysisJson(raw)).toEqual({
      analysis: 'A',
      summaries: ['r1', 'r2'],
      details: ['Long détail 1.', ''],
    });
  });

  it('tolère les fences markdown et le texte autour', () => {
    const raw = 'Voici:\n```json\n{"analyse":"A","resumes":["r1"]}\n```\nFin.';
    expect(parseAnalysisJson(raw)).toEqual({ analysis: 'A', summaries: ['r1'], details: [] });
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

  it('ajoute le détail en blockquote imbriqué sous la puce', () => {
    const body = buildJournalBody('', items, ['résumé A', 'résumé B'], ['Détail long A.', '']);
    // A : détail présent → blockquote indenté sous la puce.
    expect(body).toContain('- [Titre A](https://x/a) — résumé A\n  > Détail long A.');
    // B : détail vide → puce seule, aucun blockquote.
    expect(body).toContain('- [Titre B](https://x/b) — résumé B');
    expect(body.match(/>/g)?.length).toBe(1);
  });

  it('aplatit les détails multi-lignes et omet ceux qui répètent le résumé', () => {
    const body = buildJournalBody('', items, ['résumé A', 'résumé B'], [
      'Ligne 1.\nLigne 2.',
      'résumé B',
    ]);
    expect(body).toContain('  > Ligne 1. Ligne 2.');
    // Détail identique au résumé → omis.
    expect(body).not.toContain('> résumé B');
  });
});

describe('vérification des détails', () => {
  it('digitRuns découpe sur tout non-chiffre (robuste FR/EN)', () => {
    expect(digitRuns('$2,500 et 8.1%')).toEqual(['2', '500', '8', '1']);
    expect(digitRuns('2 500 puis 8,1 %')).toEqual(['2', '500', '8', '1']);
    expect(digitRuns('aucun chiffre')).toEqual([]);
  });

  it('numbersSupported accepte les nombres présents dans la source', () => {
    const source = 'Rivian sells 75 million shares after an 8.1% rise in 2026.';
    expect(numbersSupported('Rivian a vendu 75 millions d’actions (+8,1 %).', source)).toBe(true);
    expect(numbersSupported('Aucun chiffre cité.', source)).toBe(true);
  });

  it('numbersSupported rejette un nombre inventé', () => {
    const source = 'Rivian sells 75 million shares.';
    expect(numbersSupported('Rivian a vendu 85 millions d’actions.', source)).toBe(false);
  });

  it('buildVerifyPrompt numérote les paires article/paragraphe', () => {
    const p = buildVerifyPrompt([
      { source: 'Texte A', detail: 'Détail A' },
      { source: 'Texte B', detail: 'Détail B' },
    ]);
    expect(p).toContain('2 paires');
    expect(p).toContain('Article 1 :\nTexte A');
    expect(p).toContain('Paragraphe 2 :\nDétail B');
  });

  it('parseVerifyJson lit les verdicts et exige le bon compte', () => {
    expect(parseVerifyJson('{"fidele":[true,false]}', 2)).toEqual([true, false]);
    expect(parseVerifyJson('{"fidele":[true]}', 2)).toBeNull();
    expect(parseVerifyJson('pas de json', 1)).toBeNull();
    // Tolère les fences et le texte autour, comme les autres parseurs.
    expect(parseVerifyJson('```json\n{"fidele":[true]}\n```', 1)).toEqual([true]);
    // Tout sauf `true` franc vaut false (prudence).
    expect(parseVerifyJson('{"fidele":["oui", true]}', 2)).toEqual([false, true]);
  });

  it('parseVerifyJson tolère le tableau nu et les booléens en chaînes (sortie réelle du 7B)', () => {
    expect(parseVerifyJson('["false","true"]', 2)).toEqual([false, true]);
    expect(parseVerifyJson('[false, true]', 2)).toEqual([false, true]);
    expect(parseVerifyJson('{"fidele":["true","false"]}', 2)).toEqual([true, false]);
    expect(parseVerifyJson('["true"]', 2)).toBeNull();
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

  it('parseSynthesisJson lit idées + synthèse, null si vide/illisible', () => {
    expect(parseSynthesisJson('{"idees":["A frappe fort.","B recule."],"synthese":"Tendance globale"}')).toEqual({
      ideas: ['A frappe fort.', 'B recule.'],
      synthesis: 'Tendance globale',
    });
    expect(parseSynthesisJson('{"synthese":""}')).toBeNull();
    expect(parseSynthesisJson('rien')).toBeNull();
  });

  it('parseSynthesisJson tolère l’ancien format sans "idees"', () => {
    expect(parseSynthesisJson('{"synthese":"Tendance globale"}')).toEqual({
      ideas: [],
      synthesis: 'Tendance globale',
    });
  });

  it('parseSynthesisJson ignore les idées vides ou non textuelles', () => {
    expect(parseSynthesisJson('{"idees":["OK","",42],"synthese":"S."}')).toEqual({
      ideas: ['OK'],
      synthesis: 'S.',
    });
  });

  it('globalTitle est daté', () => {
    expect(globalTitle(new Date('2026-06-30T08:00:00'))).toContain('Synthèse du jour —');
  });

  it('buildGlobalBody met les idées fortes en tête puis la synthèse et les journaux', () => {
    const body = buildGlobalBody(
      { ideas: ['Idée majeure.', 'Idée secondaire.'], synthesis: 'Synthèse X.' },
      ['Le Monde', 'BBC'],
    );
    expect(body.indexOf('À retenir')).toBeLessThan(body.indexOf('Synthèse X.'));
    expect(body).toContain('- Idée majeure.');
    expect(body).toContain('- Idée secondaire.');
    expect(body).toContain('Journaux couverts : Le Monde, BBC');
  });

  it('buildGlobalBody sans idées reste lisible (pas de bloc vide)', () => {
    const body = buildGlobalBody({ ideas: [], synthesis: 'Seulement la synthèse.' }, []);
    expect(body).toBe('Seulement la synthèse.');
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
