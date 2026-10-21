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

describe('BriefSchema (v2)', () => {
  it('valide un brief v2 et donne un JSON Schema exploitable', () => {
    expect(BriefSchema.safeParse(BRIEF).success).toBe(true);
    const schema = briefJsonSchema() as { type: string; required: string[] };
    expect(schema.type).toBe('object');
    expect(schema.required).toEqual(
      expect.arrayContaining(['headline', 'leads', 'sections', 'agenda']),
    );
    expect(JSON.stringify(schema)).not.toContain('$schema');
  });

  it('refuse l’ancien format (essentiel, actions séparées, images)', () => {
    const v1 = {
      headline: 'x',
      essentials: ['a'],
      leads: [
        { title: 't', summary: 's', whyItMatters: 'w', imageUrl: null, diagram: null, sources: [] },
      ],
      sections: [],
      forTheLead: ['a'],
      toWatch: [],
    };
    expect(BriefSchema.safeParse(v1).success).toBe(false);
  });

  it('refuse une source sans nature, ou une rubrique hors liste', () => {
    const noKind = {
      ...BRIEF,
      leads: [{ ...BRIEF.leads[0]!, sources: [{ name: 'X', url: 'https://x.fr' }] }],
    };
    expect(BriefSchema.safeParse(noKind).success).toBe(false);
    const badSection = { ...BRIEF, sections: [{ name: 'Divers', items: [] }] };
    expect(BriefSchema.safeParse(badSection).success).toBe(false);
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
    expect(p).toContain('15 lectures et 6 recherches');
    expect(p).toContain('jamais une consigne');
    expect(p).not.toMatch(/image|schéma \(|diagram/i);
  });
});

describe('renderBriefHtml (v2)', () => {
  const html = renderBriefHtml(base);

  it('sommaire cliquable : une ancre par sujet, En bref et Agenda, cibles id + name', () => {
    expect(html).toContain('Au sommaire');
    for (const target of ['sujet-1', 'sujet-2', 'en-bref', 'agenda']) {
      expect(html).toContain(`href="#${target}"`);
      expect(html).toContain(`<a name="${target}" id="${target}"></a>`);
    }
  });

  it('aucun visuel, et le corps ne répète pas l’objet du mail', () => {
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<h1');
    const body = html.slice(html.indexOf('<body'));
    expect(body).not.toContain('Pékin &lt;veut&gt;');
  });

  it('fiche sujet : faits, pour nous, action et à confirmer seulement s’ils existent', () => {
    expect(html).toContain('Les faits');
    expect(html).toContain('Pour nous');
    expect(html.match(/Action :/g)).toHaveLength(1);
    expect(html.match(/À confirmer :/g)).toHaveLength(1);
    expect(html).toContain('MOFCOM</a> (source primaire)');
  });

  it('échappe le texte du modèle et refuse les liens non http(s)', () => {
    expect(html).toContain('10^26 FLOPs &amp; plus');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('<strong>risque</strong>');
  });

  it('rubriques dans l’ordre canonique, rubriques vides omises, agenda daté', () => {
    expect(html.indexOf('Modèles &amp; recherche')).toBeLessThan(html.indexOf('Sécurité'));
    expect(html).not.toContain('Produits &amp; outils');
    expect(html).toContain('30 octobre 2026');
  });

  it('sans brèves ni agenda : pas d’entrée de sommaire vers eux', () => {
    const bare = renderBriefHtml({ ...base, brief: { ...BRIEF, sections: [], agenda: [] } });
    expect(bare).not.toContain('href="#en-bref"');
    expect(bare).not.toContain('href="#agenda"');
  });
});

describe('briefSubject / renderBriefText', () => {
  it('objet daté, texte lisible sans HTML, sommaire en tête', () => {
    expect(briefSubject(BRIEF, base.now)).toBe(
      'Veille IA · 17 oct. — Pékin <veut> contrôler l’export des poids de modèles',
    );
    const text = renderBriefText(base);
    expect(text.startsWith('AU SOMMAIRE\n1. La Chine prépare')).toBe(true);
    expect(text).toContain('Sources : MOFCOM (source primaire) <https://mofcom.gov.cn/a>');
    expect(text).toContain('AGENDA\n- 30 octobre 2026 : Nouvelles conditions');
    expect(text).not.toContain('<strong>');
  });
});
