import { describe, it, expect } from 'vitest';
import {
  articleCharBudget,
  buildDetailPrompt,
  buildGlobalBody,
  buildGlobalPrompt,
  buildJournalBody,
  buildJournalPrompt,
  buildVerifyPrompt,
  digitRuns,
  draftVerifiedDetail,
  excerptSummary,
  globalTitle,
  journalTitle,
  numbersSupported,
  parseAnalysisJson,
  parseSynthesisJson,
  parseVerifyJson,
  verbatimDetail,
} from './pressDigest';
import { dayKey, isRunDue } from './PressDigestScheduler';
import type { NewsItem } from '../tools/web/FetchTechNewsTool';
import type { OllamaClient } from '../llm/OllamaClient';

/** Faux client Ollama : rejoue une séquence de réponses (la dernière se répète). */
function fakeLlm(responses: (string | Error)[]): OllamaClient {
  let i = 0;
  return {
    streamChat: function* (): Generator<
      { type: 'token'; content: string } | { type: 'error'; error: string }
    > {
      const r = responses[Math.min(i, responses.length - 1)];
      i++;
      if (r instanceof Error) yield { type: 'error', error: r.message };
      else if (r !== undefined) yield { type: 'token', content: r };
    },
  } as unknown as OllamaClient;
}

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
    const withBody: NewsItem = {
      ...item('Titre C', 'https://x/c', 'court extrait'),
      fullText: 'Corps complet de l’article.',
    };
    const p = buildJournalPrompt('Le Monde', [withBody]);
    expect(p).toContain('Texte : Corps complet de l’article.');
    expect(p).not.toContain('court extrait');
  });

  it('tronque chaque texte au budget par article', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      ...item(`T${i}`, `https://x/${i}`),
      fullText: 'x'.repeat(2000),
    }));
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
    const body = buildJournalBody(
      '',
      items,
      ['résumé A', 'résumé B'],
      ['Ligne 1.\nLigne 2.', 'résumé B'],
    );
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

describe('garantie de détail par article', () => {
  const rivian: NewsItem = {
    title: 'Rivian stock falls nearly 15% as company sells 75 million shares',
    url: 'https://x/r',
    source: 'CNBC',
    excerpt:
      'Rivian shares fell nearly 15% after the electric vehicle maker announced it would sell 75 million shares to raise capital during extended hours trading.',
    fullText:
      'Rivian shares fell nearly 15% after the electric vehicle maker announced it would sell 75 million shares to raise capital. The raise occurred during extended hours trading.',
  };

  it('buildDetailPrompt inclut le titre et préfère le corps téléchargé', () => {
    const p = buildDetailPrompt(rivian);
    expect(p).toContain('Titre : Rivian stock falls');
    expect(p).toContain('The raise occurred during extended hours trading.');
  });

  it('verbatimDetail cite l’extrait, coupe au mot et signale la citation', () => {
    const v = verbatimDetail(rivian);
    expect(v.startsWith("Extrait de l'article : « Rivian shares fell")).toBe(true);
    expect(v.endsWith('»')).toBe(true);
    // Matière trop maigre → pas de citation.
    expect(verbatimDetail({ title: 'T', url: 'u', source: 's', excerpt: 'court' })).toBe('');
  });

  it('verbatimDetail écarte un extrait pris en cours de phrase au profit du corps', () => {
    // Échantillon réel : extrait RSS tronqué qui démarre au milieu d'une phrase.
    const midStart = {
      ...rivian,
      excerpt:
        'optimization problem, with and without their native goal mode. Fable was an absolute beast on this benchmark, truly.',
    };
    const v = verbatimDetail(midStart);
    expect(v).toContain('Rivian shares fell'); // le fullText, qui commence à un vrai début
  });

  it('verbatimDetail coupe à la fin de phrase, jamais en plein milieu', () => {
    const phrase =
      'Rivian shares fell nearly 15% after the electric vehicle maker announced it would sell 75 million shares to raise capital. ';
    const long: NewsItem = {
      title: rivian.title,
      url: rivian.url,
      source: rivian.source,
      fullText: phrase.repeat(6),
    };
    const v = verbatimDetail(long);
    expect(v.endsWith('capital. »')).toBe(true);
  });

  it('verbatimDetail écarte un extrait de navigation et retombe sur le corps propre', () => {
    // Échantillon réel du bug des dailys : menu + sommaire cités comme « extrait ».
    const junk =
      'Fable 5 vs. GPT-5.6 Sol on an NP-Hard Problem: Does /goal Help? - Charles AZAM CA Charles Azam ' +
      'Home Projects Blog Consulting Books fr fr Home Projects Blog Consulting Books On this page The problem';
    const withBody = { ...rivian, excerpt: junk };
    const v = verbatimDetail(withBody);
    expect(v).toContain('Rivian shares fell'); // le fullText propre, pas le menu
    expect(v).not.toContain('Consulting Books');
    // Menu partout → aucune citation : rien ne vaut mieux que du déchet.
    expect(verbatimDetail({ title: 'T', url: 'u', source: 's', excerpt: junk })).toBe('');
  });

  it('excerptSummary sert un extrait rédigé et refuse un menu de site', () => {
    const prose = item('T', 'u', 'Le marché a progressé de 3 % mardi, porté par la tech.');
    expect(excerptSummary(prose)).toContain('marché');
    const junk = item(
      'T',
      'u',
      'Home Projects Blog Consulting Books fr fr Home Projects Blog On this page The problem How large is it?',
    );
    expect(excerptSummary(junk)).toBe('');
    expect(excerptSummary(item('T', 'u'))).toBe('');
    // Fragment pris en cours de phrase : pas de résumé plutôt qu'un résumé illisible.
    const midStart = item(
      'T',
      'u',
      'problem, with and without their native goal mode. Fable was a beast on this benchmark.',
    );
    expect(excerptSummary(midStart)).toBe('');
  });

  it('accepte un détail correct du premier coup', async () => {
    const bon = 'Rivian a vendu 75 millions d’actions et son titre a perdu près de 15 %.';
    const llm = fakeLlm([bon, '{"fidele":[true]}']);
    expect(await draftVerifiedDetail(llm, 'm', rivian)).toBe(bon);
  });

  it('rejette un chiffre inventé puis accepte la version corrigée', async () => {
    const faux = 'Rivian a vendu 85 millions d’actions pour lever des capitaux cette semaine.';
    const bon = 'Rivian a vendu 75 millions d’actions pour lever des capitaux cette semaine.';
    // faux → couche nombres (pas d'appel juge) → régénération → bon → juge OK.
    const llm = fakeLlm([faux, bon, '{"fidele":[true]}']);
    expect(await draftVerifiedDetail(llm, 'm', rivian)).toBe(bon);
  });

  it('rejette via le juge LLM puis accepte la version corrigée', async () => {
    const douteux = 'Le PDG Marc Dupont a annoncé la vente de 75 millions d’actions Rivian.';
    const bon = 'Rivian a annoncé la vente de 75 millions d’actions pour lever des capitaux.';
    const llm = fakeLlm([douteux, '{"fidele":[false]}', bon, '{"fidele":[true]}']);
    expect(await draftVerifiedDetail(llm, 'm', rivian)).toBe(bon);
  });

  it('retombe sur le verbatim après épuisement des tentatives', async () => {
    const faux = 'Rivian a vendu 99 millions d’actions selon le modèle qui insiste lourdement.';
    const llm = fakeLlm([faux]); // la dernière réponse se répète : toujours faux
    const out = await draftVerifiedDetail(llm, 'm', rivian);
    expect(out.startsWith("Extrait de l'article :")).toBe(true);
  });

  it('retombe sur le verbatim si Ollama est indisponible', async () => {
    const llm = fakeLlm([new Error('connexion refusée')]);
    const out = await draftVerifiedDetail(llm, 'm', rivian);
    expect(out.startsWith("Extrait de l'article :")).toBe(true);
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
    expect(
      parseSynthesisJson('{"idees":["A frappe fort.","B recule."],"synthese":"Tendance globale"}'),
    ).toEqual({
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
