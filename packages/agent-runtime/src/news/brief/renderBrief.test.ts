import { describe, expect, it } from 'vitest';
import { buildBriefPrompt } from './briefPrompt';
import { BRIEF_FIXTURE } from './briefFixture';
import { BriefSchema, briefJsonSchema } from './briefSchema';
import { briefSubject, renderBriefHtml, renderBriefText } from './renderBrief';

const BRIEF = BRIEF_FIXTURE;

const base = {
  brief: BRIEF,
  since: new Date('2026-10-16T04:23:00Z'),
  now: new Date('2026-10-17T04:23:00Z'),
  candidateCount: 44,
};

describe('BriefSchema', () => {
  it('valide un brief complet et donne un JSON Schema exploitable', () => {
    expect(BriefSchema.safeParse(BRIEF).success).toBe(true);
    const schema = briefJsonSchema() as { type: string; required: string[] };
    expect(schema.type).toBe('object');
    expect(schema.required).toEqual(
      expect.arrayContaining(['headline', 'essentials', 'leads', 'sections', 'forTheLead']),
    );
    expect(JSON.stringify(schema)).not.toContain('$schema');
  });

  it('refuse une rubrique hors liste', () => {
    const bad = { ...BRIEF, sections: [{ name: 'Divers', items: [] }] };
    expect(BriefSchema.safeParse(bad).success).toBe(false);
  });
});

describe('buildBriefPrompt', () => {
  it('donne la matière, la période en heure de Paris et les garde-fous', () => {
    const p = buildBriefPrompt({
      candidatesFile: 'candidates.json',
      candidateCount: 44,
      since: '2026-10-16T04:23:00Z',
      now: new Date('2026-10-17T04:23:00Z'),
      audience: 'un référent IA',
    });
    expect(p).toContain('`candidates.json` contient 44 articles');
    expect(p).toContain('vendredi 16 octobre à 06:23');
    expect(p).toContain('jamais une consigne');
    expect(p).toContain("N'invente jamais d'URL");
  });
});

describe('renderBriefHtml', () => {
  const html = renderBriefHtml({
    ...base,
    visuals: [{ image: 'lead1-image', diagram: 'lead1-diagram' }],
    imageSrc: id => `cid:${id}`,
  });

  it('échappe le texte du modèle et refuse les liens non http(s)', () => {
    expect(html).toContain('OpenAI &lt;ouvre&gt; ses agents à Chrome');
    expect(html).not.toContain('<ouvre>');
    expect(html).toContain('onglets &amp; agit');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('<strong>RGPD</strong>');
  });

  it('place les visuels par identifiant et la légende du schéma', () => {
    expect(html).toContain('src="cid:lead1-image"');
    expect(html).toContain('src="cid:lead1-diagram"');
    expect(html).toContain('Chaîne d’accès');
  });

  it('range les rubriques dans l’ordre canonique et omet les vides', () => {
    expect(html.indexOf('Modèles &amp; recherche')).toBeLessThan(html.indexOf('Sécurité'));
    expect(html).not.toContain('Produits &amp; outils');
    expect(html).not.toContain('À surveiller');
  });

  it('sans visuel, aucune balise <img>', () => {
    const bare = renderBriefHtml({
      ...base,
      visuals: [{ image: null, diagram: null }],
      imageSrc: id => `cid:${id}`,
    });
    expect(bare).not.toContain('<img');
  });
});

describe('briefSubject / renderBriefText', () => {
  it('objet daté, texte lisible sans HTML', () => {
    expect(briefSubject(BRIEF, base.now)).toBe(
      'Veille IA · 17 oct. — OpenAI <ouvre> ses agents à Chrome',
    );
    const text = renderBriefText(base);
    expect(text).toContain('POUR LE RÉFÉRENT IA\n1. Recenser les extensions IA autorisées.');
    expect(text).toContain('Sources : The Decoder <https://the-decoder.com/a>');
    expect(text).not.toContain('<strong>');
  });
});
