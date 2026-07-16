import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { SuggestRefactorTool } from './SuggestRefactorTool';

const tool = new SuggestRefactorTool();
let dir = '';

async function analyze(
  file: string,
  content: string,
  extra: Record<string, unknown> = {},
): Promise<any> {
  const path = join(dir, file);
  await writeFile(path, content, 'utf-8');
  return tool.run({ path, ...extra });
}

function findingTypes(data: any): string[] {
  return data.findings.map((f: any) => f.type);
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'catdesk-refactor-'));
});

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('SuggestRefactorTool', () => {
  it('rejette une extension non supportée', async () => {
    const res = await analyze('notes.txt', 'hello world');
    expect(res.success).toBe(false);
  });

  it('ne signale rien sur du code propre', async () => {
    const res = await analyze(
      'clean.ts',
      `export function add(a: number, b: number) {\n  return a + b;\n}\n`,
    );
    expect(res.success).toBe(true);
    expect(res.data.findingCount).toBe(0);
  });

  it('détecte une fonction trop longue', async () => {
    const body = Array.from({ length: 60 }, (_, i) => `  const x${i} = ${i};`).join('\n');
    const res = await analyze('long.ts', `function big() {\n${body}\n}\n`);
    expect(res.success).toBe(true);
    expect(findingTypes(res.data)).toContain('long-function');
  });

  it('détecte trop de paramètres', async () => {
    const res = await analyze('params.ts', `function many(a, b, c, d, e, f) {\n  return a;\n}\n`);
    expect(res.success).toBe(true);
    expect(findingTypes(res.data)).toContain('many-params');
  });

  it('détecte une imbrication profonde', async () => {
    const res = await analyze(
      'nested.ts',
      `function deep() {\n  if (a) {\n    if (b) {\n      if (c) {\n        if (d) {\n          return 1;\n        }\n      }\n    }\n  }\n}\n`,
    );
    expect(res.success).toBe(true);
    expect(findingTypes(res.data)).toContain('deep-nesting');
  });

  it('détecte un bloc dupliqué', async () => {
    const block = `  const a = compute(1);\n  const b = compute(2);\n  const c = compute(3);\n  const d = compute(4);\n  const e = compute(5);\n  const f = compute(6);`;
    const res = await analyze(
      'dup.ts',
      `function one() {\n${block}\n}\nfunction two() {\n${block}\n}\n`,
    );
    expect(res.success).toBe(true);
    expect(findingTypes(res.data)).toContain('duplicate-block');
  });

  it('analyse Python par indentation et ignore self', async () => {
    const body = Array.from({ length: 60 }, (_, i) => `    x${i} = ${i}`).join('\n');
    const res = await analyze('big.py', `def process(self, a, b):\n${body}\n`);
    expect(res.success).toBe(true);
    expect(res.data.functionsAnalyzed).toBe(1);
    expect(findingTypes(res.data)).toContain('long-function');
  });

  it('respecte max_findings', async () => {
    const longLines = Array.from({ length: 10 }, () => 'x'.repeat(130)).join('\n');
    const res = await analyze('manylines.ts', longLines, { max_findings: 3 });
    expect(res.success).toBe(true);
    expect(res.data.findings.length).toBeLessThanOrEqual(3);
    expect(res.data.truncated).toBe(true);
  });
});
