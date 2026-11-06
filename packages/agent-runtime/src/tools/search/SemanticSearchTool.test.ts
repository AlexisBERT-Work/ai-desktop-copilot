import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SemanticSearchTool } from './SemanticSearchTool';
import { expectOk } from '../base/testResult';

let dir = '';
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'catdesk-search-'));
  writeFileSync(join(dir, 'guide.md'), 'Configurer le webhook Discord pour la revue de presse.');
  writeFileSync(join(dir, '.env.example'), 'DISCORD_WEBHOOK_URL=\n');
  writeFileSync(join(dir, 'autre.txt'), 'Rien à voir ici.');
  mkdirSync(join(dir, 'node_modules'));
  writeFileSync(join(dir, 'node_modules', 'bruit.md'), 'webhook webhook webhook');
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('semantic_search', () => {
  const tool = new SemanticSearchTool();

  it('déclare `paths` comme chemins à vérifier (chaque entrée)', () => {
    expect(tool.filesystemTargets({ paths: ['C:/a', 'D:/b'] })).toEqual(['C:/a', 'D:/b']);
  });

  it('trouve les fichiers pertinents, ignore node_modules, indexe .env.example', async () => {
    const data = expectOk(await tool.run({ query: 'webhook discord', paths: [dir] })).data as {
      results: Array<{ absolutePath: string }>;
    };
    const files = data.results.map(r => r.absolutePath);
    expect(files).toEqual(
      expect.arrayContaining([join(dir, 'guide.md'), join(dir, '.env.example')]),
    );
    expect(files).not.toContain(join(dir, 'autre.txt'));
    expect(files.some(f => f.includes('node_modules'))).toBe(false);
  });
});
