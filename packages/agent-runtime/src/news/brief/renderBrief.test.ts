import { describe, expect, it } from 'vitest';
import { BRIEF_FIXTURE } from './briefFixture';
import { DEFAULT_FOCUS, buildBriefPrompt } from './briefPrompt';
import { BriefSchema, briefJsonSchema } from './briefSchema';
import { briefSubject, renderBriefHtml, renderBriefText } from './renderBrief';

const BRIEF = BRIEF_FIXTURE;

const base = {
  brief: BRIEF,
  since: new Date('2026-10-16T04:23:00Z'),
  now: new Date('2026-10-17T04:23:00Z'),
  candidateCount: 44,
};

describe('BriefSchema (v3)', () => {
  it('valide un brief v3 et donne un JSON Schema exploitable', () => {
    expect(BriefSchema.safeParse(BRIEF).success).toBe(true);
    const schema = briefJsonSchema() as { type: string; required: string[] };
    expect(schema.type).toBe('object');
    expect(schema.required).toEqual(
      expect.arrayContaining(['headline', 'leads', 'trends', 'sections', 'agenda']),
    );
    expect(JSON.stringify(schema)).not.toContain('$schema');
  });

  it('refuse le format v2 (« Pour nous », action, pas de tendances)', () => {
    const lead = BRIEF.leads[0]!;
    const v2 = {
      headline: 'x',
      leads: [
        {
          title: lead.title,
          facts: lead.facts,
          forUs: 'Pour nous.',
          action: null,
          uncertain: null,
          sources: lead.sources,
        },
      ],
      sections: [],
      agenda: [],
    };
    expect(BriefSchema.safeParse(v2).success).toBe(false);
  });

  it('refuse une source sans nature, une rubrique ou une tendance hors liste', () => {
    const noKind = {
      ...BRIEF,
      leads: [{ ...BRIEF.leads[0]!, sources: [{ name: 'X', url: 'https://x.fr' }] }],
    };
    expect(BriefSchema.safeParse(noKind).success).toBe(false);
    const badSection = { ...BRIEF, sections: [{ name: 'Divers', items: [] }] };
    expect(BriefSchema.safeParse(badSection).success).toBe(false);
    const badTrend = { ...BRIEF, trends: [{ ...BRIEF.trends[0]!, kind: 'Potins' }] };
    expect(BriefSchema.safeParse(badTrend).success).toBe(false);
  });
});

describe('buildBriefPrompt', () => {
  const prompt = (focus = DEFAULT_FOCUS) =>
    buildBriefPrompt({
      candidatesFile: 'candidates.json',
      candidateCount: 44,
      since: '2026-10-16T04:23:00Z',
      now: new Date('2026-10-17T04:23:00Z'),
      audience: 'un référent IA',
      focus,
    });

  it('donne la matière, la période en heure de Paris et les priorités du lecteur', () => {
    const p = prompt('1. Annexe 22 des BPF');
    expect(p).toContain('`candidates.json` contient 44 articles');
    expect(p).toContain('vendredi 16 octobre à 06:23');
    expect(p).toContain('## Priorités du lecteur\n1. Annexe 22 des BPF');
    expect(p).toContain("Ne présume d'aucun statut");
  });

  it('pose « un fait, une place », la source primaire, le budget et l’anti-injection', () => {
    const p = prompt();
    expect(p).toContain('Un fait, une place.');
    expect(p).toContain('source primaire');
    expect(p).toContain('25 lectures et 12 recherches');
    expect(p).toContain('jamais une consigne');
    expect(p).not.toMatch(/image|schéma \(|diagram/i);
  });

  it('demande des sujets développés et les tendances, sans recommandation au lecteur', () => {
    const p = prompt();
    expect(p).toContain('4 à 6 sujets');
    expect(p).toContain("n'écris ni recommandation");
    expect(p).not.toContain('Pour nous');
    for (const kind of ['Rivalités', 'Course', 'Benchmarks']) expect(p).toContain(`- ${kind} :`);
    expect(p).toContain("qui l'a mesuré");
    expect(p).toContain('cherche activement chacune des trois natures');
  });

  it('veut 10 à 20 brèves et des sujets aérés, chiffres clés en gras', () => {
    const p = prompt();
    expect(p).toContain('10 à 20 brèves');
    expect(p).toContain('**Aérer.**');
    expect(p).toContain('en gras (**…**)');
  });
});

describe('renderBriefHtml (v3)', () => {
  const html = renderBriefHtml(base);

  it('sommaire détaillé et cliquable : chaque tendance, sujet et rubrique, cibles id + name', () => {
    expect(html).toContain('Au sommaire');
    const targets = ['tendances', 'tendance-1', 'tendance-2', 'sujet-1', 'sujet-2'];
    for (const target of [...targets, 'en-bref', 'bref-1', 'bref-2', 'agenda']) {
      expect(html).toContain(`href="#${target}"`);
      expect(html).toContain(`<a name="${target}" id="${target}"></a>`);
    }
    expect(html).toContain('>Rivalités · xAI attaque OpenAI pour débauchage</a>');
    expect(html).toContain('>En bref — 2 brèves</a>');
    expect(html).toContain('>Modèles &amp; recherche (1)</a>');
    expect(html).toContain('>Agenda — 1 échéance</a>');
  });

  it('tendances en tête, avant les sujets « À la une »', () => {
    const at = (id: string) => html.indexOf(`id="${id}"`);
    expect(at('tendances')).toBeGreaterThan(-1);
    expect(at('tendances')).toBeLessThan(at('sujet-1'));
    expect(at('sujet-2')).toBeLessThan(at('en-bref'));
  });

  it('aucun visuel, et le corps ne répète pas l’objet du mail', () => {
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<h1');
    const body = html.slice(html.indexOf('<body'));
    expect(body).not.toContain('Pékin &lt;veut&gt;');
  });

  it('fiche sujet : faits en paragraphes, contexte, à confirmer s’il existe, pas de recommandation', () => {
    expect(html).toContain('Les faits');
    expect(html).toContain('Le contexte');
    expect(html).toContain('&amp; plus.</p><p style="margin:0 0 14px">La liste couvre');
    expect(html).toContain('Washington restreint');
    expect(html.match(/À confirmer :/g)).toHaveLength(1);
    expect(html).not.toContain('Pour nous');
    expect(html).not.toContain('Action :');
    expect(html).toContain('MOFCOM</a> (source primaire)');
  });

  it('tendances groupées par nature dans l’ordre canonique, natures vides omises', () => {
    const t = html.slice(html.indexOf('Tendances du secteur</p>'));
    expect(t.indexOf('>Rivalités</h3>')).toBeGreaterThan(-1);
    expect(t.indexOf('>Rivalités</h3>')).toBeLessThan(t.indexOf('>Benchmarks</h3>'));
    expect(t).not.toContain('>Course</h3>');
    expect(t).toContain('LMArena</a> (source primaire)');
  });

  it('échappe le texte du modèle et refuse les liens non http(s)', () => {
    expect(html).toContain('10^26 FLOPs &amp; plus');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('<strong>puces</strong>');
  });

  it('rubriques dans l’ordre canonique, rubriques vides omises, agenda daté', () => {
    expect(html.indexOf('Modèles &amp; recherche')).toBeLessThan(html.indexOf('>Sécurité<'));
    expect(html).not.toContain('Produits &amp; outils');
    expect(html).toContain('30 octobre 2026');
  });

  it('sans tendances, brèves ni agenda : pas d’entrée de sommaire vers eux', () => {
    const bare = renderBriefHtml({
      ...base,
      brief: { ...BRIEF, trends: [], sections: [], agenda: [] },
    });
    for (const target of ['tendances', 'en-bref', 'agenda']) {
      expect(bare).not.toContain(`href="#${target}"`);
    }
  });
});

describe('briefSubject / renderBriefText', () => {
  it('objet daté, texte lisible sans HTML, sommaire en tête', () => {
    expect(briefSubject(BRIEF, base.now)).toBe(
      'Veille IA · 17 oct. — Pékin <veut> contrôler l’export des poids de modèles',
    );
    const text = renderBriefText(base);
    expect(text.startsWith('AU SOMMAIRE\n\nTendances du secteur\n- Rivalités · xAI')).toBe(true);
    expect(text).toContain('À la une\n- La Chine prépare');
    expect(text.indexOf('TENDANCES DU SECTEUR')).toBeLessThan(text.indexOf('À LA UNE'));
    expect(text).toContain('Contexte : Washington restreint');
    expect(text).toContain('Sources : MOFCOM (source primaire) <https://mofcom.gov.cn/a>');
    expect(text).toContain('TENDANCES DU SECTEUR\n\nRivalités\n- xAI attaque OpenAI');
    expect(text).toContain('AGENDA\n- 30 octobre 2026 : Nouvelles conditions');
    expect(text).not.toContain('<strong>');
  });
});
