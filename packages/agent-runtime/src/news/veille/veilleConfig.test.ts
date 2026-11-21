import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isFresh } from './collectRepos';
import {
  CONTEXT_FILES,
  REPORTS_DIR,
  ROADMAP_FILE,
  STATE_FILE,
  archiveReport,
  loadPastPistes,
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

  it('relit le vus.json de l’artefact d’avant le 2026-11-21, sans lastSeen ni écart', () => {
    // Forme exacte de l'artefact veille-archive au 2026-11-21.
    const legacy = {
      repos: {
        'mattpocock/skills': { firstSeen: '2026-11-06', stars: 316526 },
        'CapriChooms/CapriCore': { firstSeen: '2026-11-11', stars: 120 },
      },
      releases: { 'ollama/ollama': 'v0.40.17' },
    };
    writeFileSync(join(dir, STATE_FILE), JSON.stringify(legacy));
    const state = loadVeilleState(dir);
    expect(state).toEqual(legacy);
    // Comme avant : il revient s'il double, passé le délai.
    expect(isFresh(state, 'CapriChooms/CapriCore', 240, new Date('2026-11-21T05:00:00Z'))).toBe(
      true,
    );
  });

  it('archiveReport : le rapport est rangé, et le run suivant sait ce qui a été vu', () => {
    const archive = join(dir, 'archive');
    archiveReport(archive, {
      day: '2026-11-06',
      markdown: '# Lundi',
      candidates: [{ repo: 'a/b', stars: 10, clones: [] }],
      releases: [{ repo: 'ollama/ollama', version: 'v1' }],
      rejected: [],
    });
    archiveReport(archive, {
      day: '2026-11-07',
      markdown: '# Mardi',
      candidates: [{ repo: 'c/d', stars: 20, clones: [] }],
      releases: [],
      rejected: [],
    });

    const state = loadVeilleState(archive);
    expect(state.repos['a/b']).toEqual({
      firstSeen: '2026-11-06',
      lastSeen: '2026-11-06',
      stars: 10,
    });
    expect(state.repos['c/d']).toEqual({
      firstSeen: '2026-11-07',
      lastSeen: '2026-11-07',
      stars: 20,
    });
    expect(state.releases['ollama/ollama']).toBe('v1');
    const report = join(archive, REPORTS_DIR, '2026-11-06.md');
    expect(readFileSync(report, 'utf-8')).toBe('# Lundi');
  });

  it('archiveReport : un écarté pour de bon, et ses clones, ne reviennent plus au run suivant', () => {
    const archive = join(dir, 'archive');
    archiveReport(archive, {
      day: '2026-11-13',
      markdown: '# Vendredi',
      candidates: [
        {
          repo: 'spam/blender-lab',
          stars: 506,
          clones: [{ repo: 'spam2/blender-forge', stars: 509 }],
        },
        { repo: 'young/repo', stars: 30, clones: [] },
      ],
      releases: [],
      rejected: [
        { repo: 'spam/blender-lab', cause: 'suspect' },
        { repo: 'young/repo', cause: 'trop_jeune' },
      ],
    });
    const state = loadVeilleState(archive);
    const later = new Date('2026-12-30T05:00:00Z');
    expect(isFresh(state, 'spam/blender-lab', 50_000, later)).toBe(false);
    expect(isFresh(state, 'spam2/blender-forge', 50_000, later)).toBe(false);
    expect(isFresh(state, 'young/repo', 60, later)).toBe(true);
  });

  it('le contexte lu par la collecte est celui que le workflow extrait (sparse-checkout)', () => {
    const workflow = readFileSync(
      join(__dirname, '../../../../../.github/workflows/ai-veille.yml'),
      'utf-8',
    ).replace(/\r\n/g, '\n');
    const sparse = /sparse-checkout: \|\n((?:\s{12}\S.*\n)+)/.exec(workflow)?.[1] ?? '';
    const listed = sparse
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean);
    expect(listed).toEqual([...CONTEXT_FILES]);
    expect(listed).toContain(ROADMAP_FILE);
  });

  it('loadPastPistes : rapports des 30 derniers jours, du plus ancien au plus récent', () => {
    const reports = join(dir, REPORTS_DIR);
    mkdirSync(reports, { recursive: true });
    const piste = (title: string, repo: string) =>
      `## 🟢 À faire ensemble : ${title}\n\n[${repo}](https://github.com/${repo}) · Outil\n`;
    writeFileSync(join(reports, '2026-09-01.md'), piste('Trop ancienne', 'old/one'));
    writeFileSync(join(reports, '2026-11-07.md'), piste('Récente', 'new/two'));
    writeFileSync(join(reports, '2026-11-06.md'), piste('Hier', 'mid/one'));
    writeFileSync(join(reports, 'notes.md'), piste('Pas un rapport', 'x/y'));

    const past = loadPastPistes(dir, new Date('2026-11-08T05:00:00Z'), 30);
    expect(past.map(p => `${p.day} ${p.repo}`)).toEqual([
      '2026-11-06 mid/one',
      '2026-11-07 new/two',
    ]);
    expect(past[0]).toMatchObject({ verdict: 'a_faire', title: 'Hier' });
  });

  it('loadPastPistes : premier run, aucune archive', () => {
    expect(loadPastPistes(join(dir, 'absent'), new Date(), 30)).toEqual([]);
  });

  it('un fichier abîmé échoue : repartir à vide écraserait l’archive', () => {
    writeFileSync(join(dir, STATE_FILE), '{ pas du json');
    expect(() => loadVeilleState(dir)).toThrow();
    writeFileSync(join(dir, STATE_FILE), '{"repos":"non"}');
    expect(() => loadVeilleState(dir)).toThrow();
  });
});
