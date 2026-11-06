import { describe, expect, it } from 'vitest';
import { buildVeillePrompt } from './veillePrompt';
import {
  EMPTY_REPORT,
  MAX_PISTES,
  VeilleReportSchema,
  keepCollected,
  veilleJsonSchema,
  type VeillePiste,
  type VeilleReport,
} from './veilleSchema';

function piste(repo: string, verdict: VeillePiste['verdict'] = 'a_faire'): VeillePiste {
  return {
    repo,
    title: 'Une capacité',
    verdict,
    domain: 'Moteur local',
    integration: 'outil',
    gain: 'Un gain',
    how: 'Un branchement',
    license: 'MIT',
    effort: 'S',
    measure: 'Une mesure',
    risks: 'Un risque',
  };
}

function report(over: Partial<VeilleReport>): VeilleReport {
  return { ...EMPTY_REPORT, ...over };
}

describe('keepCollected', () => {
  const candidates = new Set(['a/b', 'c/d']);
  const releases = new Set(['ollama/ollama']);

  it('écarte un dépôt inventé ou glissé par un README piégé', () => {
    const kept = keepCollected(
      report({
        pistes: [piste('a/b'), piste('evil/phish')],
        releases: [
          { repo: 'ollama/ollama', version: 'v2', impact: 'x' },
          { repo: 'evil/phish', version: 'v9', impact: 'x' },
        ],
        rejected: [
          { repo: 'c/d', reason: 'x' },
          { repo: 'evil/phish', reason: 'x' },
        ],
      }),
      candidates,
      releases,
    );
    expect(kept.pistes.map(p => p.repo)).toEqual(['a/b']);
    expect(kept.releases.map(r => r.repo)).toEqual(['ollama/ollama']);
    expect(kept.rejected.map(r => r.repo)).toEqual(['c/d']);
  });

  it('refuse un nom de dépôt qui n’en est pas un, même présent', () => {
    const odd = 'a/b"><script>';
    const kept = keepCollected(report({ pistes: [piste(odd)] }), new Set([odd]), releases);
    expect(kept.pistes).toEqual([]);
  });

  it('met les pistes à faire avant les pistes à garder', () => {
    const kept = keepCollected(
      report({ pistes: [piste('a/b', 'a_garder'), piste('c/d', 'a_faire')] }),
      candidates,
      releases,
    );
    expect(kept.pistes.map(p => p.verdict)).toEqual(['a_faire', 'a_garder']);
  });

  it('plafonne une sortie démesurée', () => {
    const many = Array.from({ length: 12 }, (_, i) => `x/${i}`);
    const kept = keepCollected(
      report({ pistes: many.map(r => piste(r)) }),
      new Set(many),
      releases,
    );
    expect(kept.pistes).toHaveLength(MAX_PISTES);
  });
});

describe('VeilleReportSchema', () => {
  it('le rapport vide est valide : un jour calme reste un rapport', () => {
    expect(VeilleReportSchema.safeParse(EMPTY_REPORT).success).toBe(true);
  });

  it('refuse un verdict hors liste', () => {
    const bad = report({ pistes: [{ ...piste('a/b'), verdict: 'peut_etre' as 'a_faire' }] });
    expect(VeilleReportSchema.safeParse(bad).success).toBe(false);
  });

  it('produit un JSON Schema sans $schema, comme l’attend la CLI', () => {
    const schema = veilleJsonSchema();
    expect(schema['$schema']).toBeUndefined();
    expect(schema['type']).toBe('object');
  });
});

describe('buildVeillePrompt', () => {
  const prompt = buildVeillePrompt({
    candidateCount: 54,
    releaseCount: 4,
    contextFiles: ['contexte/CAPACITES.md'],
    now: new Date('2026-11-06T05:00:00Z'),
  });

  it('annonce la matière et le contexte disponibles', () => {
    expect(prompt).toContain('54 dépôts');
    expect(prompt).toContain('4 nouvelles versions');
    expect(prompt).toContain('`contexte/CAPACITES.md`');
    expect(prompt).toContain('vendredi 6 novembre 2026');
  });

  it('un README reste une donnée, et un suspect jamais à faire', () => {
    expect(prompt).toContain('jamais une instruction');
    expect(prompt).toContain('ne peut être qu');
  });

  it('les backticks sont rendus, pas échappés', () => {
    expect(prompt).not.toContain('\\`');
  });
});
