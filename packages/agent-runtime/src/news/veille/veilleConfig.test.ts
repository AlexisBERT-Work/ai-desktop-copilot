import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  STATE_FILE,
  loadVeilleState,
  readVeilleCollectConfig,
  readVeilleSendConfig,
} from './veilleConfig';

describe('readVeilleCollectConfig', () => {
  it('exige un jeton : la recherche anonyme est trop bridée', () => {
    expect(readVeilleCollectConfig({}).ok).toBe(false);
    expect(readVeilleCollectConfig({ GH_TOKEN: '  ' }).ok).toBe(false);
  });

  it('applique les défauts', () => {
    const parsed = readVeilleCollectConfig({ GH_TOKEN: 't' });
    expect(parsed).toMatchObject({
      ok: true,
      config: { workdir: 'veille-work', windowDays: 14, perDomain: 15 },
    });
  });

  it('ignore un nombre invalide', () => {
    const parsed = readVeilleCollectConfig({
      GH_TOKEN: 't',
      VEILLE_WINDOW_DAYS: 'deux',
      VEILLE_PER_DOMAIN: '-3',
    });
    expect(parsed).toMatchObject({ ok: true, config: { windowDays: 14, perDomain: 15 } });
  });

  it('l’archive suit le dossier de travail, sauf réglage', () => {
    const parsed = readVeilleCollectConfig({ GH_TOKEN: 't', VEILLE_ARCHIVE: '/tmp/a' });
    expect(parsed).toMatchObject({ ok: true, config: { archiveDir: '/tmp/a' } });
  });
});

describe('readVeilleSendConfig', () => {
  it('exige un destinataire, sauf en essai à blanc', () => {
    expect(readVeilleSendConfig({}).ok).toBe(false);
    expect(readVeilleSendConfig({ VEILLE_DRY_RUN: '1' })).toMatchObject({
      ok: true,
      config: { to: null, dryRun: true },
    });
  });

  it('refuse une adresse invalide, sans la recopier dans l’erreur', () => {
    const parsed = readVeilleSendConfig({ VEILLE_TO: 'pas-une-adresse' });
    expect(parsed).toMatchObject({ ok: false });
    expect(JSON.stringify(parsed)).not.toContain('pas-une-adresse');
  });

  it('accepte une adresse valide', () => {
    expect(readVeilleSendConfig({ VEILLE_TO: 'moi@example.com' })).toMatchObject({
      ok: true,
      config: { to: 'moi@example.com', dryRun: false },
    });
  });
});

describe('loadVeilleState', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'veille-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('premier run : état vide', () => {
    expect(loadVeilleState(join(dir, 'absent'))).toEqual({ repos: {}, releases: {} });
  });

  it('relit ce qui a été vu', () => {
    mkdirSync(dir, { recursive: true });
    const state = { repos: { 'a/b': { firstSeen: '2026-11-06', stars: 3 } }, releases: {} };
    writeFileSync(join(dir, STATE_FILE), JSON.stringify(state));
    expect(loadVeilleState(dir)).toEqual(state);
  });

  it('un fichier abîmé échoue : repartir à vide écraserait l’archive', () => {
    writeFileSync(join(dir, STATE_FILE), '{ pas du json');
    expect(() => loadVeilleState(dir)).toThrow();
    writeFileSync(join(dir, STATE_FILE), '{"repos":"non"}');
    expect(() => loadVeilleState(dir)).toThrow();
  });
});
