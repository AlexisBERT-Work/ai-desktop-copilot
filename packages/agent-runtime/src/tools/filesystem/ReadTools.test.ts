import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReadFileTool } from './ReadFileTool';
import { ListDirTool } from './ListDirTool';
import { expectFail, expectOk } from '../base/testResult';

let dir = '';
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'catdesk-fs-'));
  writeFileSync(join(dir, 'notes.txt'), 'bonjour');
  writeFileSync(join(dir, '.cache'), 'caché');
  mkdirSync(join(dir, 'sous'));
  writeFileSync(join(dir, 'sous', 'b.md'), '# titre');
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('read_file', () => {
  const tool = new ReadFileTool();

  it('déclare `path` comme chemin à vérifier par la liste blanche', () => {
    expect(tool.filesystemTargets({ path: 'C:/x.txt' })).toEqual(['C:/x.txt']);
  });

  it('lit un fichier texte', async () => {
    const data = expectOk(await tool.run({ path: join(dir, 'notes.txt') })).data as {
      content: string;
      size: number;
    };
    expect(data.content).toBe('bonjour');
    expect(data.size).toBe(7);
  });

  it('lit en base64 sur demande', async () => {
    const data = expectOk(await tool.run({ path: join(dir, 'notes.txt'), encoding: 'base64' }))
      .data as { content: string };
    expect(Buffer.from(data.content, 'base64').toString()).toBe('bonjour');
  });

  it('refuse un dossier, un fichier absent, et un fichier au-delà du plafond', async () => {
    expect(expectFail(await tool.run({ path: dir })).error).toContain("n'est pas un fichier");
    expect(expectFail(await tool.run({ path: join(dir, 'absent.txt') })).error).toContain(
      'Impossible de lire',
    );
    expect(
      expectFail(await tool.run({ path: join(dir, 'notes.txt'), maxBytes: 3 })).error,
    ).toContain('trop grand');
  });

  it('refuse des arguments invalides avant tout accès disque', async () => {
    expect(expectFail(await tool.run({})).error).toContain('Arguments invalides');
  });
});

describe('list_directory', () => {
  const tool = new ListDirTool();

  it('liste les entrées, dossiers d’abord, fichiers cachés exclus', async () => {
    const data = expectOk(await tool.run({ path: dir })).data as {
      entries: Array<{ name: string; type: string }>;
    };
    expect(data.entries.map(e => `${e.type}:${e.name}`)).toEqual([
      'directory:sous',
      'file:notes.txt',
    ]);
  });

  it('inclut les cachés et descend récursivement sur demande', async () => {
    const data = expectOk(await tool.run({ path: dir, includeHidden: true, recursive: true }))
      .data as { entries: Array<{ name: string }> };
    const names = data.entries.map(e => e.name);
    expect(names).toEqual(expect.arrayContaining(['.cache', 'b.md', 'notes.txt', 'sous']));
  });

  it('échoue proprement sur un dossier absent', async () => {
    expect(expectFail(await tool.run({ path: join(dir, 'absent') })).error).toContain(
      'Impossible de lister',
    );
  });
});
