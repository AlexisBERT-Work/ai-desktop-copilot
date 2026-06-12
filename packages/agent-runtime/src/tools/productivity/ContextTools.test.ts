import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { tallyFile, AnalyzeCodeStyleTool } from './AnalyzeCodeStyleTool';
import { detectStack, summarizeReadme, LoadProjectContextTool } from './LoadProjectContextTool';

describe('tallyFile / analyze_code_style', () => {
  it('infère 2-spaces, single quotes, semicolons, camelCase', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ndstyle-'));
    const code = `const myVar = 'hello';\nfunction doThing() {\n  const innerValue = 'x';\n  return innerValue;\n}\n`;
    await writeFile(join(dir, 'a.ts'), code);
    const res: any = await new AnalyzeCodeStyleTool().execute({ workdir: dir });
    expect(res.success).toBe(true);
    expect(res.data.conventions.indentation).toBe('2 spaces');
    expect(res.data.conventions.quotes).toBe('single');
    expect(res.data.conventions.semicolons).toBe(true);
    expect(res.data.conventions.naming).toBe('camelCase');
    await rm(dir, { recursive: true, force: true });
  });

  it('détecte snake_case et 4 espaces (Python)', () => {
    const t = {
      files: 0, indentTabs: 0, indentSpaces: 0, spaceWidths: {} as Record<number, number>,
      singleQuotes: 0, doubleQuotes: 0, semicolons: 0, noSemicolons: 0,
      camelCase: 0, snakeCase: 0, longLines: 0, totalLines: 0,
    };
    tallyFile('def my_func():\n    inner_value = 1\n    return inner_value\n', t);
    expect(t.snakeCase).toBeGreaterThan(0);
    expect(t.spaceWidths[4]).toBeGreaterThan(0);
  });
});

describe('detectStack', () => {
  it('reconnaît la stack et le gestionnaire de paquets', () => {
    const r = detectStack(new Set(['package.json', 'tsconfig.json', 'pnpm-lock.yaml', 'Cargo.toml']));
    expect(r.stack).toEqual(expect.arrayContaining(['Node.js/JS', 'TypeScript', 'Rust']));
    expect(r.packageManager).toBe('pnpm');
  });
});

describe('summarizeReadme', () => {
  it('extrait titre + intro, ignore les badges', () => {
    const md = `# My Project\n\n![badge](x)\n\nA local-first tool for X.\n`;
    const s = summarizeReadme(md);
    expect(s).toContain('My Project');
    expect(s).toContain('local-first');
    expect(s).not.toContain('badge');
  });
});

describe('LoadProjectContextTool', () => {
  const tool = new LoadProjectContextTool();
  let dir = '';

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ndproj-'));
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'package.json'), JSON.stringify({
      name: 'cool-app', scripts: { dev: 'vite', build: 'vite build' }, dependencies: { react: '^19' }, main: 'src/index.ts',
    }));
    await writeFile(join(dir, 'pnpm-lock.yaml'), '');
    await writeFile(join(dir, 'README.md'), '# Cool App\n\nDoes cool things locally.\n');
  });

  afterAll(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it('profile le projet', async () => {
    const res: any = await tool.execute({ workdir: dir });
    expect(res.success).toBe(true);
    const d = res.data;
    expect(d.project).toBe('cool-app');
    expect(d.packageManager).toBe('pnpm');
    expect(d.scripts).toEqual(expect.arrayContaining(['dev', 'build']));
    expect(d.topLevelDirs).toContain('src');
    expect(d.howToRun).toBe('pnpm run dev');
    expect(d.readmeSummary).toContain('Cool App');
  });
});
