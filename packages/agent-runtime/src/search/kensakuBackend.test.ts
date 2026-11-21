import { describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  KENSAKU_MAX_RESULTS,
  KENSAKU_PINNED,
  KensakuBackend,
  kensakuCandidates,
  parseKensakuOutput,
  type KensakuDeps,
} from './kensakuBackend';

const CLI = 'C:/outils/kensaku-cli.exe';
const PINNED_1017 = Object.keys(KENSAKU_PINNED).find(h => KENSAKU_PINNED[h] === '1.0.17') ?? '';

const RESPONSE = JSON.stringify({
  results: [
    {
      path: 'C:/Users/moi/Documents/devis.pdf',
      score: 0.91,
      snippet: 'Devis cuisine',
      match_type: 'Both',
      size: 1024,
      modified: 1761400000,
    },
    { path: '', score: 0.5 },
    { score: 0.4, snippet: 'sans chemin' },
    { path: 'C:/Users/moi/Pictures/capture.png' },
  ],
  total: 12,
  mode: 'ranked',
  returned: 4,
});

function deps(overrides: Partial<KensakuDeps> = {}): KensakuDeps & {
  run: ReturnType<typeof vi.fn>;
  sha256: ReturnType<typeof vi.fn>;
} {
  return {
    candidates: () => [CLI],
    stat: async () => ({ mtimeMs: 1, size: 25_745_408 }),
    sha256: vi.fn(async () => PINNED_1017),
    run: vi.fn(async () => ({ stdout: RESPONSE, stderr: '' })),
    ...overrides,
  } as KensakuDeps & { run: ReturnType<typeof vi.fn>; sha256: ReturnType<typeof vi.fn> };
}

const execError = (fields: Record<string, unknown>): Error =>
  Object.assign(new Error('Command failed'), fields);

describe('KensakuBackend — détection et épinglage', () => {
  it('épingle 1.0.16 et 1.0.17, jamais une version antérieure', () => {
    expect(Object.values(KENSAKU_PINNED).sort()).toEqual(['1.0.16', '1.0.17']);
    for (const digest of Object.keys(KENSAKU_PINNED)) expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('le script d’installation pose une version épinglée ici', () => {
    const script = readFileSync(
      fileURLToPath(new URL('../../../../scripts/fetch-kensaku.ps1', import.meta.url)),
      'utf8',
    );
    const version = /\$Version = '([^']+)'/.exec(script)?.[1];
    const digest = /\$Sha256 = '([0-9a-f]{64})'/.exec(script)?.[1] ?? '';
    expect(version).toBeDefined();
    expect(KENSAKU_PINNED[digest]).toBe(version);
    // PowerShell 5.1 lit un .ps1 sans BOM en cp1252 : ASCII seulement.
    expect(/^[\t\n\r -~]*$/.test(script)).toBe(true);
  });

  it('CLI absent : rien n’est lancé', async () => {
    const d = deps({ stat: async () => null });
    const out = await new KensakuBackend(d).search('devis', { limit: 10 });
    expect(out).toMatchObject({ ok: false, reason: 'absent' });
    expect(d.run).not.toHaveBeenCalled();
  });

  it('empreinte inconnue : le binaire n’est jamais lancé', async () => {
    const d = deps({ sha256: vi.fn(async () => 'f'.repeat(64)) });
    const out = await new KensakuBackend(d).search('devis', { limit: 10 });
    expect(out).toMatchObject({ ok: false, reason: 'untrusted' });
    expect(d.run).not.toHaveBeenCalled();
  });

  it('haché illisible = inconnu', async () => {
    const d = deps({ sha256: vi.fn(async () => Promise.reject(new Error('EBUSY'))) });
    const out = await new KensakuBackend(d).search('devis', { limit: 10 });
    expect(out).toMatchObject({ ok: false, reason: 'untrusted' });
    expect(d.run).not.toHaveBeenCalled();
  });

  it('ne rehache que si la date ou la taille change', async () => {
    let mtimeMs = 1;
    const d = deps({ stat: async () => ({ mtimeMs, size: 10 }) });
    const backend = new KensakuBackend(d);
    await backend.search('a', { limit: 5 });
    await backend.search('b', { limit: 5 });
    expect(d.sha256).toHaveBeenCalledTimes(1);
    mtimeMs = 2; // binaire remplacé
    await backend.search('c', { limit: 5 });
    expect(d.sha256).toHaveBeenCalledTimes(2);
  });

  it('un binaire remplacé par un inconnu est refusé dès l’appel suivant', async () => {
    let digest = PINNED_1017;
    let size = 10;
    const d = deps({
      stat: async () => ({ mtimeMs: 1, size }),
      sha256: vi.fn(async () => digest),
    });
    const backend = new KensakuBackend(d);
    expect((await backend.search('a', { limit: 5 })).ok).toBe(true);
    digest = 'e'.repeat(64);
    size = 11;
    expect(await backend.search('a', { limit: 5 })).toMatchObject({ reason: 'untrusted' });
    expect(d.run).toHaveBeenCalledTimes(1);
  });

  it('prend le premier candidat présent', async () => {
    const d = deps({
      candidates: () => ['C:/absent.exe', CLI],
      stat: async p => (p === CLI ? { mtimeMs: 1, size: 1 } : null),
    });
    await new KensakuBackend(d).search('a', { limit: 5 });
    expect(d.run.mock.calls[0]?.[0]).toBe(CLI);
  });
});

describe('KensakuBackend — appel du CLI', () => {
  it('sans shell : `--` avant la requête, qui reste un seul argument', async () => {
    const d = deps();
    await new KensakuBackend(d).search('-brouillon "devis" ; del *', { limit: 10 });
    const [program, args, opts] = d.run.mock.calls[0] as [string, string[], { timeoutMs: number }];
    expect(program).toBe(CLI);
    expect(args).toEqual(['search', '--json', '--limit', '10', '--', '-brouillon "devis" ; del *']);
    expect(opts.timeoutMs).toBeGreaterThan(0);
  });

  it('passe le dossier en `--path`, avant `--`', async () => {
    const d = deps();
    await new KensakuBackend(d).search('devis', { limit: 3, scope: 'C:/Users/moi/Documents' });
    expect(d.run.mock.calls[0]?.[1]).toEqual([
      'search',
      '--json',
      '--limit',
      '3',
      '--path',
      'C:/Users/moi/Documents',
      '--',
      'devis',
    ]);
  });

  it('borne la limite à ce que Kensaku accepte', async () => {
    const d = deps();
    await new KensakuBackend(d).search('a', { limit: 500 });
    await new KensakuBackend(d).search('a', { limit: 0 });
    expect(d.run.mock.calls.map(c => (c[1] as string[])[3])).toEqual([
      String(KENSAKU_MAX_RESULTS),
      '1',
    ]);
  });

  it('rend les résultats bien formés et le total', async () => {
    const out = await new KensakuBackend(deps()).search('devis', { limit: 10 });
    expect(out).toEqual({
      ok: true,
      version: '1.0.17',
      total: 12,
      hits: [
        {
          path: 'C:/Users/moi/Documents/devis.pdf',
          score: 0.91,
          snippet: 'Devis cuisine',
          matchType: 'Both',
          sizeBytes: 1024,
        },
        {
          path: 'C:/Users/moi/Pictures/capture.png',
          score: 0,
          snippet: '',
          matchType: null,
          sizeBytes: null,
        },
      ],
    });
  });

  it('code 3 : pas d’index', async () => {
    const d = deps({ run: vi.fn(async () => Promise.reject(execError({ code: 3 }))) });
    expect(await new KensakuBackend(d).search('a', { limit: 5 })).toMatchObject({
      ok: false,
      reason: 'no_index',
    });
  });

  it('délai dépassé ou autre code : échec, sans lever', async () => {
    const killed = deps({ run: vi.fn(async () => Promise.reject(execError({ killed: true }))) });
    expect(await new KensakuBackend(killed).search('a', { limit: 5 })).toMatchObject({
      reason: 'failed',
      detail: expect.stringContaining('délai'),
    });
    const crashed = deps({
      run: vi.fn(async () => Promise.reject(execError({ code: 1, stderr: 'index corrompu' }))),
    });
    expect(await new KensakuBackend(crashed).search('a', { limit: 5 })).toMatchObject({
      reason: 'failed',
      detail: 'code 1 : index corrompu',
    });
  });

  it('sortie illisible : bad_output', async () => {
    const d = deps({ run: vi.fn(async () => ({ stdout: 'path\t0.9\tsnippet', stderr: '' })) });
    expect(await new KensakuBackend(d).search('a', { limit: 5 })).toMatchObject({
      reason: 'bad_output',
    });
  });
});

describe('parseKensakuOutput', () => {
  it('refuse ce qui n’a pas de tableau `results`', () => {
    expect(parseKensakuOutput('{"total":1}')).toBeNull();
    expect(parseKensakuOutput('[]')).toBeNull();
    expect(parseKensakuOutput('')).toBeNull();
  });

  it('accepte une réponse vide', () => {
    expect(parseKensakuOutput('{"results":[]}')).toEqual({ hits: [], total: null });
  });
});

/**
 * Le vrai CLI, s'il est installé (`scripts/fetch-kensaku.ps1`) : vérifie le
 * format réel de `--json`. Ignoré partout ailleurs, CI comprise.
 */
const installed = kensakuCandidates().some(p => existsSync(p));
describe.skipIf(!installed)('KensakuBackend — vrai CLI installé', () => {
  it('épinglé, et répond (ou signale l’absence d’index)', async () => {
    const out = await new KensakuBackend().search('facture', { limit: 5 });
    if (!out.ok) {
      expect(out.reason).toBe('no_index');
      return;
    }
    expect(Object.values(KENSAKU_PINNED)).toContain(out.version);
    for (const h of out.hits) expect(h.path.length).toBeGreaterThan(0);
  }, 20_000);
});

describe('kensakuCandidates', () => {
  it('CATDESK_KENSAKU_CLI prime, seul', () => {
    expect(kensakuCandidates({ CATDESK_KENSAKU_CLI: ' D:/k.exe ', LOCALAPPDATA: 'C:/L' })).toEqual([
      'D:/k.exe',
    ]);
  });

  it('sinon %LOCALAPPDATA%\\nd-kensaku, sous ses deux noms ; variable vide = absente', () => {
    expect(kensakuCandidates({ CATDESK_KENSAKU_CLI: '', LOCALAPPDATA: 'C:/L' })).toEqual([
      join('C:/L', 'nd-kensaku', 'kensaku-cli.exe'),
      join('C:/L', 'nd-kensaku', 'kensaku-cli-windows-x86_64.exe'),
    ]);
    expect(kensakuCandidates({})).toEqual([]);
  });
});
