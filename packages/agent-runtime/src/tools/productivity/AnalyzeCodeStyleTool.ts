import { readdir, readFile, stat } from 'fs/promises';
import { join, extname } from 'path';
import type { ToolResult } from '@neurodesk/shared-types';
import { TOOL_SCHEMAS } from '@neurodesk/shared-types';
import { BaseTool } from '../base/BaseTool';

interface AnalyzeCodeStyleArgs {
  workdir?: string;
  extensions?: string[];
  max_files?: number;
}

const DEFAULT_EXT = ['.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go'];
const SKIP_DIRS = new Set(['node_modules', 'target', '.git', 'dist', 'build', '.next', '__pycache__', '.venv', 'coverage']);

interface StyleTally {
  files: number;
  indentTabs: number;
  indentSpaces: number;
  spaceWidths: Record<number, number>;
  singleQuotes: number;
  doubleQuotes: number;
  semicolons: number;
  noSemicolons: number;
  camelCase: number;
  snakeCase: number;
  longLines: number;
  totalLines: number;
}

function emptyTally(): StyleTally {
  return {
    files: 0, indentTabs: 0, indentSpaces: 0, spaceWidths: {}, singleQuotes: 0, doubleQuotes: 0,
    semicolons: 0, noSemicolons: 0, camelCase: 0, snakeCase: 0, longLines: 0, totalLines: 0,
  };
}

// Accumulate style signals from one file's content (pure, exported for tests).
export function tallyFile(content: string, tally: StyleTally): void {
  tally.files++;
  const lines = content.split('\n');
  tally.totalLines += lines.length;

  for (const line of lines) {
    if (line.length > 100) tally.longLines++;
    const indent = line.match(/^([ \t]+)\S/);
    if (indent) {
      const ws = indent[1] ?? '';
      if (ws.includes('\t')) tally.indentTabs++;
      else {
        tally.indentSpaces++;
        const w = ws.length;
        // Track the smallest non-trivial step (2 or 4 most common).
        if (w === 2 || w === 4) tally.spaceWidths[w] = (tally.spaceWidths[w] ?? 0) + 1;
      }
    }
  }

  tally.singleQuotes += (content.match(/'/g) ?? []).length;
  tally.doubleQuotes += (content.match(/"/g) ?? []).length;

  // Semicolon usage at line ends (JS/TS heuristic).
  for (const line of lines) {
    const t = line.trim();
    if (t.length === 0 || t.startsWith('//') || t.startsWith('*')) continue;
    if (/[;]$/.test(t)) tally.semicolons++;
    else if (/[\w)\]'"`]$/.test(t)) tally.noSemicolons++;
  }

  // Identifier naming from declarations.
  for (const m of content.matchAll(/\b(?:const|let|var|function|def|fn|func)\s+([A-Za-z_]\w*)/g)) {
    const name = m[1] ?? '';
    if (/[a-z][a-zA-Z0-9]*[A-Z]/.test(name)) tally.camelCase++;
    else if (name.includes('_') && name === name.toLowerCase()) tally.snakeCase++;
  }
}

function summarize(t: StyleTally) {
  const indent = t.indentTabs > t.indentSpaces ? 'tabs' : 'spaces';
  const width = (t.spaceWidths[2] ?? 0) >= (t.spaceWidths[4] ?? 0) ? 2 : 4;
  const quotes = t.singleQuotes >= t.doubleQuotes ? 'single' : 'double';
  const semicolons = t.semicolons >= t.noSemicolons;
  const naming = t.camelCase >= t.snakeCase ? 'camelCase' : 'snake_case';
  return {
    indentation: indent === 'spaces' ? `${width} spaces` : 'tabs',
    quotes,
    semicolons,
    naming,
    avgLineLength: t.totalLines > 0 ? Math.round((t.totalLines - t.longLines) / t.totalLines * 100) / 100 : 0,
    longLineRatio: t.totalLines > 0 ? Math.round((t.longLines / t.totalLines) * 1000) / 1000 : 0,
  };
}

async function sampleFiles(root: string, exts: Set<string>, max: number): Promise<string[]> {
  const out: string[] = [];
  async function recurse(dir: string): Promise<void> {
    if (out.length >= max) return;
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= max) return;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) await recurse(join(dir, e.name));
      } else if (e.isFile() && exts.has(extname(e.name).toLowerCase()) && !e.name.endsWith('.test.ts') && !e.name.endsWith('.d.ts')) {
        out.push(join(dir, e.name));
      }
    }
  }
  await recurse(root);
  return out;
}

export class AnalyzeCodeStyleTool extends BaseTool {
  readonly name = 'analyze_code_style';
  readonly description =
    "Déduit les conventions de style du projet (indentation tabs/espaces + largeur, guillemets, point-virgules, camelCase vs snake_case, longueur de ligne) en échantillonnant les fichiers source. Sert à écrire du code cohérent avec l'existant.";
  readonly category = 'analysis' as const;
  readonly riskLevel = 'low' as const;
  readonly requiresConfirmation = false;
  readonly schema = TOOL_SCHEMAS.analyze_code_style;

  async execute(args: unknown): Promise<ToolResult> {
    const { workdir, extensions, max_files = 40 } = args as AnalyzeCodeStyleArgs;
    const root = workdir ?? process.cwd();
    const exts = new Set((extensions && extensions.length > 0 ? extensions : DEFAULT_EXT).map((e) => e.toLowerCase()));

    try {
      const s = await stat(root);
      if (!s.isDirectory()) return this.fail(`${root} n'est pas un dossier.`);
    } catch {
      return this.fail(`Dossier introuvable: ${root}`);
    }

    const files = await sampleFiles(root, exts, Math.max(1, max_files));
    if (files.length === 0) return this.fail('Aucun fichier source à analyser pour les extensions données.');

    const tally = emptyTally();
    for (const f of files) {
      try { tallyFile(await readFile(f, 'utf-8'), tally); } catch { /* skip */ }
    }

    return this.ok({
      filesSampled: tally.files,
      conventions: summarize(tally),
      note: 'Conventions inférées par échantillonnage — à respecter quand tu écris/édites du code dans ce projet.',
    });
  }
}
