import { describe, expect, it } from 'vitest';
import {
  BRIEF_DEFAULT_SOURCES,
  readCollectConfig,
  readSendConfig,
  recapWindowHours,
} from './recapConfig';
import { DEFAULT_AUDIENCE, DEFAULT_FOCUS } from './briefPrompt';

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
  it('défauts : sources du brief, 120 candidats, lectorat et priorités génériques', () => {
    const r = readCollectConfig({ RECAP_SINCE: '2026-10-16T05:30:00Z' }, NOW);
    expect(r).toEqual({
      ok: true,
      config: {
        workdir: 'recap-work',
        sourceIds: [...BRIEF_DEFAULT_SOURCES],
        sinceHours: 24,
        limit: 120,
        audience: DEFAULT_AUDIENCE,
        focus: DEFAULT_FOCUS,
      },
    });
  });

  it('sources par défaut : analyse et presse dedans ; agrégats, tutoriels et flux bloqués dehors', () => {
    expect(BRIEF_DEFAULT_SOURCES).toEqual(
      expect.arrayContaining(['oneusefulthing', 'normaltech', 'nextinpact', 'cnil', 'importai']),
    );
    for (const id of ['bensbites', 'huggingface', 'eu_digital', 'euaiact']) {
      expect(BRIEF_DEFAULT_SOURCES).not.toContain(id);
    }
  });

  it('RECAP_FOCUS remplace les priorités par défaut', () => {
    const r = readCollectConfig({ RECAP_FOCUS: '1. Annexe 22\n2. EMA' }, NOW);
    expect(r.ok && r.config.focus).toBe('1. Annexe 22\n2. EMA');
  });

  it('refuse une source inconnue, borne le nombre de candidats', () => {
    expect(readCollectConfig({ RECAP_SOURCES: 'actuia,nimporte' }, NOW)).toEqual({
      ok: false,
      error: 'Source(s) inconnue(s) — nimporte',
    });
    const r = readCollectConfig({ RECAP_SOURCES: 'actuia, openai', RECAP_LIMIT: '900' }, NOW);
    expect(r.ok && r.config).toMatchObject({ sourceIds: ['actuia', 'openai'], limit: 200 });
  });

  it('RECAP_EXTRA_SOURCES s’ajoute aux sources par défaut, sans doublon', () => {
    const r = readCollectConfig({ RECAP_EXTRA_SOURCES: 'stat_healthtech, ema, actuia' }, NOW);
    expect(r.ok && r.config.sourceIds).toEqual([
      ...BRIEF_DEFAULT_SOURCES,
      'stat_healthtech',
      'ema',
    ]);
    expect(readCollectConfig({ RECAP_EXTRA_SOURCES: 'pharma_inconnue' }, NOW).ok).toBe(false);
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
