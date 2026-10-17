import { describe, expect, it } from 'vitest';
import {
  BRIEF_DEFAULT_SOURCES,
  readCollectConfig,
  readSendConfig,
  recapWindowHours,
} from './recapConfig';
import { DEFAULT_AUDIENCE } from './briefPrompt';

const NOW = new Date('2026-10-17T05:30:00Z');

describe('recapWindowHours', () => {
  it('depuis le dernier envoi, arrondi à l’heure supérieure', () => {
    expect(recapWindowHours('2026-10-16T04:25:00Z', NOW)).toBe(26);
  });

  it('24 h sans date connue (premier run) ou illisible', () => {
    expect(recapWindowHours(undefined, NOW)).toBe(24);
    expect(recapWindowHours('', NOW)).toBe(24);
    expect(recapWindowHours('hier', NOW)).toBe(24);
  });

  it('bornée : 72 h après plusieurs matins ratés, 1 h au minimum', () => {
    expect(recapWindowHours('2026-10-10T05:00:00Z', NOW)).toBe(72);
    expect(recapWindowHours('2026-10-17T06:00:00Z', NOW)).toBe(1);
  });
});

describe('readCollectConfig', () => {
  it('défauts : sources IA + Pixels + CNIL, 120 candidats, lectorat référent IA', () => {
    const r = readCollectConfig({ RECAP_SINCE: '2026-10-16T05:30:00Z' }, NOW);
    expect(r).toEqual({
      ok: true,
      config: {
        workdir: 'recap-work',
        sourceIds: [...BRIEF_DEFAULT_SOURCES],
        sinceHours: 24,
        limit: 120,
        audience: DEFAULT_AUDIENCE,
      },
    });
    expect(BRIEF_DEFAULT_SOURCES).toEqual(expect.arrayContaining(['actuia', 'cnil', 'euaiact']));
  });

  it('refuse une source inconnue, borne le nombre de candidats', () => {
    expect(readCollectConfig({ RECAP_SOURCES: 'actuia,nimporte' }, NOW)).toEqual({
      ok: false,
      error: 'RECAP_SOURCES : source(s) inconnue(s) — nimporte',
    });
    const r = readCollectConfig({ RECAP_SOURCES: 'actuia, openai', RECAP_LIMIT: '900' }, NOW);
    expect(r.ok && r.config).toMatchObject({ sourceIds: ['actuia', 'openai'], limit: 200 });
  });
});

describe('readSendConfig', () => {
  it('exige un destinataire valide, sauf en essai à blanc', () => {
    expect(readSendConfig({}).ok).toBe(false);
    expect(readSendConfig({ RECAP_TO: 'moi@boulot' }).ok).toBe(false);
    const dry = readSendConfig({ RECAP_DRY_RUN: 'true', RECAP_WORKDIR: '/tmp/r' });
    expect(dry.ok && dry.config).toEqual({
      workdir: '/tmp/r',
      to: null,
      dryRun: true,
      out: 'recap-preview.html',
    });
    const real = readSendConfig({ RECAP_TO: 'moi@boulot.fr' });
    expect(real.ok && real.config.to).toBe('moi@boulot.fr');
  });
});
