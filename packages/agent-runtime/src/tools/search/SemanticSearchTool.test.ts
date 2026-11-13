import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SemanticSearchTool, tokenize } from './SemanticSearchTool';
import { expectOk } from '../base/testResult';
import type { KensakuHit, KensakuOutcome, KensakuSearch } from '../../search/kensakuBackend';

interface Payload {
  engine: string;
  results: Array<Record<string, unknown> & { absolutePath: string }>;
  outOfScope?: number;
}

let base = '';
let dir = '';
let outside = '';
beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), 'catdesk-search-'));
  dir = join(base, 'docs');
  outside = join(base, 'dehors');
  mkdirSync(dir);
  mkdirSync(outside);
  writeFileSync(join(dir, 'guide.md'), 'Configurer le webhook Discord pour la revue de presse.');
  writeFileSync(join(dir, '.env.example'), 'DISCORD_WEBHOOK_URL=\n');
  writeFileSync(join(dir, 'autre.txt'), 'Rien à voir ici.');
  writeFileSync(join(dir, 'compte-rendu.md'), "Compte rendu de la réunion d'été : budget validé.");
  writeFileSync(join(dir, 'syndicat.md'), 'Le syndicat demande une union des forces.');
  writeFileSync(join(dir, 'devis.pdf'), '%PDF-1.7 binaire');
  writeFileSync(join(dir, 'panne.log'), 'Le webhook Discord a répondu 429.');
  mkdirSync(join(dir, 'node_modules'));
  writeFileSync(join(dir, 'node_modules', 'bruit.md'), 'webhook webhook webhook');
  writeFileSync(join(outside, 'secret.md'), 'webhook discord secret');
  symlinkSync(outside, join(dir, 'lien'), 'junction');
});
afterAll(() => rmSync(base, { recursive: true, force: true }));

/** Liste blanche des tests : le seul dossier `docs`. */
const onlyDocs = (): readonly string[] => [dir];

function fakeKensaku(
  outcome: KensakuOutcome,
): KensakuSearch & { search: ReturnType<typeof vi.fn> } {
  return { search: vi.fn(async () => outcome) };
}

const hit = (path: string, extra: Partial<KensakuHit> = {}): KensakuHit => ({
  path,
  score: 0.9,
  snippet: 'devis de la cuisine',
  matchType: 'Both',
  sizeBytes: 2048,
  ...extra,
});

describe('tokenize', () => {
  it('garde les lettres accentuées : « réunion » ne devient plus « union »', () => {
    // Un nombre seul n'est pas un terme (comme avant) : il faut une lettre en tête.
    expect(tokenize('Réunion d’été 2026')).toEqual(['réunion', 'été']);
    expect(tokenize('crème brûlée')).toEqual(['crème', 'brûlée']);
  });

  it('retire les mots grammaticaux et les doublons', () => {
    expect(tokenize('les notes de la réunion pour la réunion budget')).toEqual([
      'notes',
      'réunion',
      'budget',
    ]);
  });
});

describe('semantic_search — moteur par mots-clés', () => {
  const tool = new SemanticSearchTool({ kensaku: null, pathWhitelist: onlyDocs });

  it('déclare `paths` comme chemins à vérifier (chaque entrée)', () => {
    expect(tool.filesystemTargets({ paths: ['C:/a', 'D:/b'] })).toEqual(['C:/a', 'D:/b']);
  });

  it('trouve les fichiers pertinents, ignore node_modules, indexe .env.example', async () => {
    const data = expectOk(await tool.run({ query: 'webhook discord', paths: [dir] }))
      .data as Payload;
    const files = data.results.map(r => r.absolutePath);
    expect(data.engine).toBe('keywords');
    expect(files).toEqual(
      expect.arrayContaining([
        realpathSync(join(dir, 'guide.md')),
        realpathSync(join(dir, '.env.example')),
      ]),
    );
    expect(files).not.toContain(realpathSync(join(dir, 'autre.txt')));
    expect(files.some(f => f.includes('node_modules'))).toBe(false);
  });

  it('ne suit pas une jonction vers un dossier hors liste', async () => {
    const data = expectOk(await tool.run({ query: 'secret webhook', paths: [dir] }))
      .data as Payload;
    expect(data.results.some(r => r.absolutePath.includes('secret'))).toBe(false);
  });

  it('cherche en français : accents compris, sans faux positif sur « union »', async () => {
    const data = expectOk(await tool.run({ query: 'la réunion de cet été', paths: [dir] }))
      .data as Payload;
    const files = data.results.map(r => r.absolutePath);
    expect(files).toContain(realpathSync(join(dir, 'compte-rendu.md')));
    expect(files).not.toContain(realpathSync(join(dir, 'syndicat.md')));
  });

  it('sans `paths` : les dossiers de la liste blanche, plus le dossier courant', async () => {
    const data = expectOk(await tool.run({ query: 'webhook discord' })).data as Payload;
    expect(data.results.length).toBeGreaterThan(0);
    const root = realpathSync(dir);
    expect(data.results.every(r => r.absolutePath.startsWith(root))).toBe(true);
  });

  it('ne lit pas un fichier plus gros que `max_file_size`', async () => {
    const data = expectOk(
      await tool.run({ query: 'webhook discord', paths: [dir], max_file_size: 30 }),
    ).data as Payload & { totalScanned: number };
    // Seul `.env.example` (22 octets) tient sous 30 octets parmi les candidats.
    expect(data.results.map(r => r.absolutePath)).toEqual([
      realpathSync(join(dir, '.env.example')),
    ]);
  });

  it('une liste d’extensions devinée ne fait perdre aucun fichier texte', async () => {
    // Ce que le modèle passe sans qu'on le lui demande : avant, la liste
    // remplaçait les types par défaut, et `guide.md` disparaissait.
    const data = expectOk(
      await tool.run({
        query: 'webhook discord',
        paths: [dir],
        extensions: ['.PDF', '.docx', 'txt'],
      }),
    ).data as Payload & { ignoredExtensions?: string[] };
    const files = data.results.map(r => r.absolutePath);
    expect(files).toEqual(
      expect.arrayContaining([
        realpathSync(join(dir, 'guide.md')),
        realpathSync(join(dir, '.env.example')),
      ]),
    );
    // PDF et Office ne sont jamais lus en octets bruts, et le résultat le dit.
    expect(files).not.toContain(realpathSync(join(dir, 'devis.pdf')));
    expect(data.ignoredExtensions).toEqual(['.pdf', '.docx']);
  });

  it('une extension hors des types par défaut s’ajoute à eux', async () => {
    const sans = expectOk(await tool.run({ query: 'webhook', paths: [dir] })).data as Payload;
    expect(sans.results.map(r => r.absolutePath)).not.toContain(
      realpathSync(join(dir, 'panne.log')),
    );

    const avec = expectOk(await tool.run({ query: 'webhook', paths: [dir], extensions: ['log'] }))
      .data as Payload & { ignoredExtensions?: string[] };
    const files = avec.results.map(r => r.absolutePath);
    expect(files).toContain(realpathSync(join(dir, 'panne.log')));
    expect(files).toContain(realpathSync(join(dir, 'guide.md')));
    expect(avec.ignoredExtensions).toBeUndefined();
  });

  it('garde la forme des résultats', async () => {
    const data = expectOk(await tool.run({ query: 'webhook', paths: [dir], limit: 1 }))
      .data as Payload;
    expect(Object.keys(data.results[0] ?? {}).sort()).toEqual(
      ['absolutePath', 'file', 'matchCount', 'score', 'sizeBytes', 'snippet'].sort(),
    );
  });
});

describe('semantic_search — moteur Kensaku', () => {
  it('sert les résultats de Kensaku, filtrés par le périmètre (jonction comprise)', async () => {
    const kensaku = fakeKensaku({
      ok: true,
      version: '1.0.17',
      total: 3,
      hits: [
        hit(join(dir, 'devis.pdf')),
        hit(join(outside, 'secret.md')),
        hit(join(dir, 'lien', 'secret.md')),
      ],
    });
    const tool = new SemanticSearchTool({ kensaku, pathWhitelist: onlyDocs });
    const data = expectOk(await tool.run({ query: 'devis cuisine' })).data as Payload;

    expect(data.engine).toBe('kensaku');
    expect(data.results.map(r => r.absolutePath)).toEqual([realpathSync(join(dir, 'devis.pdf'))]);
    expect(data.outOfScope).toBe(2);
    expect(data.results[0]).toMatchObject({
      score: 0.9,
      matchCount: 2,
      snippet: 'devis de la cuisine',
      sizeBytes: 2048,
      matchType: 'Both',
    });
    // Un seul dossier par défaut : il est passé à Kensaku pour qu'il cherche dessous.
    expect(kensaku.search).toHaveBeenCalledWith('devis cuisine', {
      limit: 50,
      scope: dir,
    });
  });

  it('les PDF passent : `max_file_size` ne borne que l’ancien moteur', async () => {
    const kensaku = fakeKensaku({
      ok: true,
      version: '1.0.17',
      total: 1,
      hits: [hit(join(dir, 'devis.pdf'), { sizeBytes: 9_000_000 })],
    });
    const tool = new SemanticSearchTool({ kensaku, pathWhitelist: onlyDocs });
    const data = expectOk(await tool.run({ query: 'devis', max_file_size: 1000 })).data as Payload;
    expect(data.results).toHaveLength(1);
  });

  it('les extensions ne restreignent pas Kensaku (une liste devinée perdait des fichiers)', async () => {
    const kensaku = fakeKensaku({
      ok: true,
      version: '1.0.17',
      total: 2,
      hits: [hit(join(dir, 'devis.pdf')), hit(join(dir, 'guide.md'))],
    });
    const tool = new SemanticSearchTool({ kensaku, pathWhitelist: onlyDocs });
    const data = expectOk(await tool.run({ query: 'devis', extensions: ['md'] })).data as Payload;
    expect(data.results.map(r => r.absolutePath)).toEqual([
      realpathSync(join(dir, 'devis.pdf')),
      realpathSync(join(dir, 'guide.md')),
    ]);
  });

  it('Kensaku indisponible : l’ancien moteur répond', async () => {
    const kensaku = fakeKensaku({ ok: false, reason: 'untrusted', detail: 'empreinte inconnue' });
    const tool = new SemanticSearchTool({ kensaku, pathWhitelist: onlyDocs });
    const data = expectOk(await tool.run({ query: 'webhook discord', paths: [dir] }))
      .data as Payload;
    expect(data.engine).toBe('keywords');
    expect(data.results.length).toBeGreaterThan(0);
  });

  it('rien de Kensaku dans le périmètre : l’ancien moteur répond', async () => {
    const kensaku = fakeKensaku({
      ok: true,
      version: '1.0.17',
      total: 1,
      hits: [hit(join(outside, 'secret.md'))],
    });
    const tool = new SemanticSearchTool({ kensaku, pathWhitelist: onlyDocs });
    const data = expectOk(await tool.run({ query: 'webhook discord', paths: [dir] }))
      .data as Payload;
    expect(data.engine).toBe('keywords');
    expect(data.results.some(r => r.absolutePath.includes('secret'))).toBe(false);
  });

  it('plusieurs dossiers : aucun `scope`, le filtre fait le tri', async () => {
    const kensaku = fakeKensaku({ ok: true, version: '1.0.17', total: 0, hits: [] });
    const tool = new SemanticSearchTool({ kensaku, pathWhitelist: () => [dir, outside] });
    await tool.run({ query: 'devis' });
    expect(kensaku.search).toHaveBeenCalledWith('devis', { limit: 50 });
  });
});
