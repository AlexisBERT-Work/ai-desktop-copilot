import { readFile, access } from 'fs/promises';
import { dirname, basename, extname, join } from 'path';
import type { ToolResult } from '@catdesk/shared-types';
import { TOOL_SCHEMAS } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';

type Framework = 'vitest' | 'jest' | 'pytest' | 'cargo' | 'go';

interface GenerateUnitTestsArgs {
  path: string;
  framework?: 'auto' | Framework;
  symbol?: string;
}

interface ExportedSymbol {
  name: string;
  kind: 'function' | 'class' | 'const';
  isAsync: boolean;
  isDefault: boolean;
}

const LANG_BY_EXT: Record<string, 'ts' | 'js' | 'py' | 'rust' | 'go'> = {
  '.ts': 'ts', '.tsx': 'ts', '.mts': 'ts', '.cts': 'ts',
  '.js': 'js', '.jsx': 'js', '.mjs': 'js', '.cjs': 'js',
  '.py': 'py',
  '.rs': 'rust',
  '.go': 'go',
};

// ─── Framework detection ───────────────────────────────────────

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function detectFramework(
  sourcePath: string,
  lang: 'ts' | 'js' | 'py' | 'rust' | 'go',
): Promise<Framework> {
  if (lang === 'rust') return 'cargo';
  if (lang === 'go') return 'go';
  if (lang === 'py') return 'pytest';

  // JS/TS: walk up to find package.json and read its deps.
  let dir = dirname(sourcePath);
  for (let i = 0; i < 8; i++) {
    const pkgPath = join(dir, 'package.json');
    if (await fileExists(pkgPath)) {
      try {
        const pkg = JSON.parse(await readFile(pkgPath, 'utf-8')) as {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if ('vitest' in deps) return 'vitest';
        if ('jest' in deps || 'ts-jest' in deps || '@jest/globals' in deps) return 'jest';
      } catch {
        // ignore malformed package.json and keep walking
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Vitest is the project default (see CLAUDE.md / existing *.test.ts).
  return 'vitest';
}

// ─── Symbol extraction ─────────────────────────────────────────

function extractJsSymbols(src: string): ExportedSymbol[] {
  const symbols: ExportedSymbol[] = [];
  const seen = new Set<string>();

  const push = (name: string, kind: ExportedSymbol['kind'], isAsync: boolean, isDefault: boolean) => {
    if (name.length === 0 || seen.has(name)) return;
    seen.add(name);
    symbols.push({ name, kind, isAsync, isDefault });
  };

  // export [default] [async] function foo(
  const fnRe = /export\s+(default\s+)?(async\s+)?function\s+([A-Za-z_$][\w$]*)/g;
  let m: RegExpExecArray | null;
  while ((m = fnRe.exec(src)) !== null) {
    push(m[3] ?? '', 'function', m[2] !== undefined, m[1] !== undefined);
  }

  // export class Foo
  const classRe = /export\s+(default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g;
  while ((m = classRe.exec(src)) !== null) {
    push(m[2] ?? '', 'class', false, m[1] !== undefined);
  }

  // export const foo = [async] (  →  arrow function
  const arrowRe = /export\s+const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g;
  while ((m = arrowRe.exec(src)) !== null) {
    push(m[1] ?? '', 'function', m[2] !== undefined, false);
  }

  // export { a, b as c }
  const reExportRe = /export\s*\{([^}]+)\}/g;
  while ((m = reExportRe.exec(src)) !== null) {
    for (const part of (m[1] ?? '').split(',')) {
      const name = part.split(/\s+as\s+/).pop()?.trim() ?? '';
      if (name.length > 0 && name !== 'default') push(name, 'const', false, false);
    }
  }

  return symbols;
}

function extractPySymbols(src: string): ExportedSymbol[] {
  const symbols: ExportedSymbol[] = [];
  const seen = new Set<string>();
  // Top-level (no indentation) def / async def / class, skipping private _names.
  const re = /^(async\s+)?(def|class)\s+([A-Za-z_][\w]*)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const name = m[3] ?? '';
    if (name.startsWith('_') || seen.has(name)) continue;
    seen.add(name);
    symbols.push({
      name,
      kind: m[2] === 'class' ? 'class' : 'function',
      isAsync: m[1] !== undefined,
      isDefault: false,
    });
  }
  return symbols;
}

function extractRustSymbols(src: string): ExportedSymbol[] {
  const symbols: ExportedSymbol[] = [];
  const seen = new Set<string>();
  const re = /pub\s+(async\s+)?fn\s+([A-Za-z_][\w]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const name = m[2] ?? '';
    if (seen.has(name)) continue;
    seen.add(name);
    symbols.push({ name, kind: 'function', isAsync: m[1] !== undefined, isDefault: false });
  }
  return symbols;
}

function extractGoSymbols(src: string): ExportedSymbol[] {
  const symbols: ExportedSymbol[] = [];
  const seen = new Set<string>();
  // Exported (Capitalized) top-level functions.
  const re = /^func\s+(?:\([^)]*\)\s+)?([A-Z][\w]*)\s*\(/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const name = m[1] ?? '';
    if (seen.has(name)) continue;
    seen.add(name);
    symbols.push({ name, kind: 'function', isAsync: false, isDefault: false });
  }
  return symbols;
}

// ─── Test file path convention ─────────────────────────────────

function testFilePathFor(sourcePath: string, lang: string, framework: Framework): string {
  const dir = dirname(sourcePath);
  const ext = extname(sourcePath);
  const stem = basename(sourcePath, ext);

  if (framework === 'cargo') {
    // Rust: idiomatic in-file `#[cfg(test)] mod tests` — same file.
    return sourcePath;
  }
  if (framework === 'go') {
    return join(dir, `${stem}_test.go`);
  }
  if (framework === 'pytest') {
    return join(dir, `test_${stem}.py`);
  }
  // vitest / jest: foo.ts -> foo.test.ts next to source
  return join(dir, `${stem}.test${ext}`);
}

// ─── Scaffold builders ─────────────────────────────────────────

function jsScaffold(symbols: ExportedSymbol[], stem: string, framework: Framework): string {
  const importLine =
    framework === 'vitest'
      ? "import { describe, it, expect } from 'vitest';"
      : "import { describe, it, expect } from '@jest/globals';";

  const named = symbols.filter((s) => !s.isDefault).map((s) => s.name);
  const def = symbols.find((s) => s.isDefault);
  const importParts: string[] = [];
  if (def) importParts.push(def.name);
  if (named.length > 0) importParts.push(`{ ${named.join(', ')} }`);
  const sourceImport =
    importParts.length > 0
      ? `import ${importParts.join(', ')} from './${stem}';`
      : `import * as mod from './${stem}';`;

  const blocks = symbols.map((s) => {
    const call = s.isAsync ? `await ${s.name}(/* args */)` : `${s.name}(/* args */)`;
    const kindHint = s.kind === 'class' ? `new ${s.name}(/* args */)` : call;
    return `  describe('${s.name}', () => {
    it('TODO: describe expected behaviour', ${s.isAsync ? 'async ' : ''}() => {
      // const result = ${kindHint};
      // expect(result).toBe(/* expected */);
      expect(true).toBe(true);
    });
  });`;
  });

  return `${importLine}
${sourceImport}

describe('${stem}', () => {
${blocks.join('\n\n')}
});
`;
}

function pyScaffold(symbols: ExportedSymbol[], stem: string): string {
  const names = symbols.map((s) => s.name).join(', ');
  const blocks = symbols.map(
    (s) => `def test_${s.name}():
    # TODO: describe expected behaviour
    # result = ${s.kind === 'class' ? `${s.name}(...)` : `${s.name}(...)`}
    assert True`,
  );
  return `import pytest

from ${stem} import ${names || '*'}


${blocks.join('\n\n\n')}
`;
}

function rustScaffold(symbols: ExportedSymbol[]): string {
  const blocks = symbols.map(
    (s) => `    #[test]
    fn test_${s.name}() {
        // TODO: describe expected behaviour
        // assert_eq!(${s.name}(/* args */), /* expected */);
        assert!(true);
    }`,
  );
  return `#[cfg(test)]
mod tests {
    use super::*;

${blocks.join('\n\n')}
}
`;
}

function goScaffold(symbols: ExportedSymbol[]): string {
  const blocks = symbols.map(
    (s) => `func Test${s.name}(t *testing.T) {
\t// TODO: describe expected behaviour
\t// got := ${s.name}(/* args */)
\t// if got != want { t.Errorf("got %v, want %v", got, want) }
}`,
  );
  return `import "testing"

${blocks.join('\n\n')}
`;
}

// ─── Tool ──────────────────────────────────────────────────────

export class GenerateUnitTestsTool extends BaseTool {
  readonly name = 'generate_unit_tests';
  readonly description =
    "Détecte le framework de test du projet et génère un squelette de tests unitaires pour un fichier source (vitest/jest/pytest/cargo/go). Extrait les symboles exportés et propose un scaffold + le chemin du fichier de test.";
  readonly category = 'analysis' as const;
  readonly riskLevel = 'low' as const;
  readonly requiresConfirmation = false;
  readonly schema = TOOL_SCHEMAS.generate_unit_tests;

  async execute(args: unknown): Promise<ToolResult> {
    const { path, framework = 'auto', symbol } = args as GenerateUnitTestsArgs;

    if (typeof path !== 'string' || path.trim().length === 0) {
      return this.fail('path est requis');
    }

    const ext = extname(path).toLowerCase();
    const lang = LANG_BY_EXT[ext];
    if (lang === undefined) {
      return this.fail(`Extension non supportée: ${ext || '(aucune)'}. Supporté: .ts/.tsx/.js/.py/.rs/.go`);
    }

    let src: string;
    try {
      src = await readFile(path, 'utf-8');
    } catch (err) {
      return this.fail(`Impossible de lire le fichier: ${err instanceof Error ? err.message : String(err)}`);
    }

    const resolvedFramework: Framework =
      framework === 'auto' ? await detectFramework(path, lang) : framework;

    let symbols: ExportedSymbol[];
    switch (lang) {
      case 'ts':
      case 'js': symbols = extractJsSymbols(src); break;
      case 'py': symbols = extractPySymbols(src); break;
      case 'rust': symbols = extractRustSymbols(src); break;
      case 'go': symbols = extractGoSymbols(src); break;
    }

    if (typeof symbol === 'string' && symbol.length > 0) {
      symbols = symbols.filter((s) => s.name === symbol);
      if (symbols.length === 0) {
        return this.fail(`Symbole "${symbol}" introuvable parmi les exports du fichier.`);
      }
    }

    if (symbols.length === 0) {
      return this.fail('Aucun symbole exporté/public détecté à tester dans ce fichier.');
    }

    const ext2 = extname(path);
    const stem = basename(path, ext2);
    const testFilePath = testFilePathFor(path, lang, resolvedFramework);

    let scaffold: string;
    switch (resolvedFramework) {
      case 'vitest':
      case 'jest': scaffold = jsScaffold(symbols, stem, resolvedFramework); break;
      case 'pytest': scaffold = pyScaffold(symbols, stem); break;
      case 'cargo': scaffold = rustScaffold(symbols); break;
      case 'go': scaffold = goScaffold(symbols); break;
    }

    return this.ok({
      framework: resolvedFramework,
      language: lang,
      testFilePath,
      appendToSource: resolvedFramework === 'cargo',
      symbols: symbols.map((s) => ({ name: s.name, kind: s.kind, isAsync: s.isAsync })),
      symbolCount: symbols.length,
      scaffold,
      note: 'Squelette à compléter : remplace les TODO/placeholders par de vrais cas (nominal, limites, erreurs). Le LLM doit raffiner les assertions à partir du code source.',
    });
  }
}
