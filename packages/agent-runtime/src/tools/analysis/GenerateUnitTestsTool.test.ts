import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { GenerateUnitTestsTool } from './GenerateUnitTestsTool';

const tool = new GenerateUnitTestsTool();
let dir = '';

async function gen(file: string, content: string, extra: Record<string, unknown> = {}): Promise<any> {
  const path = join(dir, file);
  await writeFile(path, content, 'utf-8');
  const res = await tool.execute({ path, ...extra });
  return res;
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'catdesk-tests-'));
  // No package.json => JS/TS defaults to vitest.
});

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('GenerateUnitTestsTool', () => {
  it('rejette une extension non supportée', async () => {
    const res = await gen('data.txt', 'hello');
    expect(res.success).toBe(false);
  });

  it('extrait les exports TS et génère un scaffold vitest', async () => {
    const res = await gen(
      'math.ts',
      `export function add(a: number, b: number) { return a + b; }
export const mul = (a: number, b: number) => a * b;
export async function fetchAll() { return []; }
export class Calculator {}
function helper() {} // not exported
`,
    );
    expect(res.success).toBe(true);
    const d = res.data;
    expect(d.framework).toBe('vitest');
    expect(d.language).toBe('ts');
    expect(d.testFilePath).toMatch(/math\.test\.ts$/);
    const names = d.symbols.map((s: any) => s.name).sort();
    expect(names).toEqual(['Calculator', 'add', 'fetchAll', 'mul']);
    expect(d.scaffold).toContain("from 'vitest'");
    // all exported names appear in the source import line
    const importLine = d.scaffold.split('\n').find((l: string) => l.includes("from './math'")) ?? '';
    for (const n of ['add', 'mul', 'fetchAll', 'Calculator']) expect(importLine).toContain(n);
    // async symbol gets an async test callback
    expect(d.scaffold).toContain('async () =>');
  });

  it('filtre sur un symbole précis', async () => {
    const res = await gen(
      'svc.ts',
      `export function a() {}
export function b() {}
`,
      { symbol: 'b' },
    );
    expect(res.success).toBe(true);
    expect(res.data.symbolCount).toBe(1);
    expect(res.data.symbols[0].name).toBe('b');
  });

  it('échoue si le symbole demandé est absent', async () => {
    const res = await gen('z.ts', 'export function a() {}', { symbol: 'nope' });
    expect(res.success).toBe(false);
  });

  it('gère Python avec pytest et ignore les fonctions privées', async () => {
    const res = await gen(
      'service.py',
      `def public_fn():
    pass

async def async_fn():
    pass

def _private():
    pass

class Widget:
    pass
`,
    );
    expect(res.success).toBe(true);
    const d = res.data;
    expect(d.framework).toBe('pytest');
    expect(d.testFilePath).toMatch(/test_service\.py$/);
    const names = d.symbols.map((s: any) => s.name).sort();
    expect(names).toEqual(['Widget', 'async_fn', 'public_fn']);
    expect(d.scaffold).toContain('import pytest');
    expect(d.scaffold).toContain('def test_public_fn');
  });

  it('génère un module de tests Rust inline et signale appendToSource', async () => {
    const res = await gen(
      'lib.rs',
      `pub fn parse(s: &str) -> u32 { 0 }
fn private_helper() {}
`,
    );
    expect(res.success).toBe(true);
    const d = res.data;
    expect(d.framework).toBe('cargo');
    expect(d.appendToSource).toBe(true);
    expect(d.testFilePath).toMatch(/lib\.rs$/);
    expect(d.scaffold).toContain('#[cfg(test)]');
    expect(d.scaffold).toContain('fn test_parse');
  });

  it('détecte jest depuis package.json', async () => {
    const sub = join(dir, 'jestproj');
    await writeFile(join(dir, 'pkgmarker'), '');
    const { mkdir } = await import('fs/promises');
    await mkdir(sub, { recursive: true });
    await writeFile(
      join(sub, 'package.json'),
      JSON.stringify({ devDependencies: { jest: '^29.0.0' } }),
      'utf-8',
    );
    await writeFile(join(sub, 'thing.ts'), 'export function go() {}', 'utf-8');
    const res: any = await tool.execute({ path: join(sub, 'thing.ts') });
    expect(res.success).toBe(true);
    expect(res.data.framework).toBe('jest');
    expect(res.data.scaffold).toContain('@jest/globals');
  });
});
