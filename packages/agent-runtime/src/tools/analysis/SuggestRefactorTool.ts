import { readFile } from 'fs/promises';
import { extname, basename } from 'path';
import type { ToolResult } from '@neurodesk/shared-types';
import { TOOL_SCHEMAS } from '@neurodesk/shared-types';
import { BaseTool } from '../base/BaseTool';

interface SuggestRefactorArgs {
  path: string;
  max_findings?: number;
}

type Severity = 'info' | 'warning';

interface Finding {
  type: string;
  line: number;
  severity: Severity;
  message: string;
}

const BRACE_LANGS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.rs', '.go', '.java', '.c', '.cpp']);
const PY_EXT = new Set(['.py']);

// Tunable thresholds.
const LONG_FUNCTION = 50;       // lines in a function body
const MANY_PARAMS = 5;          // parameters in a signature
const DEEP_NESTING = 4;         // nesting depth
const LONG_FILE = 400;          // lines in a file
const LONG_LINE = 120;          // characters
const DUP_BLOCK_MIN = 6;        // consecutive identical lines to flag

// ─── Function detection (brace languages) ──────────────────────

function findFunctionsBrace(lines: string[]): Array<{ line: number; name: string; bodyLines: number; params: number }> {
  const out: Array<{ line: number; name: string; bodyLines: number; params: number }> = [];
  // Matches: function foo(...) | foo(...) { | const foo = (...) => | pub fn foo(...) | func Foo(...)
  const sigRe = /(?:function\s+([A-Za-z_$][\w$]*)|(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_$][\w$]*)|func\s+(?:\([^)]*\)\s+)?([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?\([^)]*\)\s*(?::[^=]+)?=>|\b([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{)/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const m = line.match(sigRe);
    if (m === null) continue;
    const name = m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? '<anonymous>';

    // Count params from the first parenthesised group on the line.
    const paren = line.match(/\(([^)]*)\)/);
    const params = paren && paren[1]?.trim() ? paren[1].split(',').length : 0;

    // Find the opening brace and walk to its matching close to size the body.
    const braceIdx = line.indexOf('{', m.index ?? 0);
    if (braceIdx === -1) continue; // signature spans lines or is a declaration only

    let depth = 0;
    let bodyLines = 0;
    let closed = false;
    for (let j = i; j < lines.length; j++) {
      const l = lines[j] ?? '';
      const from = j === i ? braceIdx : 0;
      for (let k = from; k < l.length; k++) {
        const ch = l[k];
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) { bodyLines = j - i; closed = true; break; }
        }
      }
      if (closed) break;
    }
    if (closed) out.push({ line: i + 1, name, bodyLines, params });
  }
  return out;
}

// ─── Function detection (Python, indentation) ──────────────────

function findFunctionsPython(lines: string[]): Array<{ line: number; name: string; bodyLines: number; params: number }> {
  const out: Array<{ line: number; name: string; bodyLines: number; params: number }> = [];
  const defRe = /^(\s*)(?:async\s+)?def\s+([A-Za-z_][\w]*)\s*\(([^)]*)\)/;
  for (let i = 0; i < lines.length; i++) {
    const m = (lines[i] ?? '').match(defRe);
    if (m === null) continue;
    const indent = (m[1] ?? '').length;
    const name = m[2] ?? '';
    const params = m[3]?.trim()
      ? m[3].split(',').filter((p) => p.trim() && p.trim() !== 'self' && p.trim() !== 'cls').length
      : 0;

    // Body runs until a line at the same-or-lower indentation (ignoring blanks).
    let end = i;
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j] ?? '';
      if (l.trim().length === 0) continue;
      const lead = l.length - l.trimStart().length;
      if (lead <= indent) break;
      end = j;
    }
    out.push({ line: i + 1, name, bodyLines: end - i, params });
  }
  return out;
}

// ─── Nesting depth ─────────────────────────────────────────────

function maxBraceNesting(lines: string[]): { depth: number; line: number } {
  let depth = 0;
  let max = 0;
  let maxLine = 0;
  for (let i = 0; i < lines.length; i++) {
    for (const ch of lines[i] ?? '') {
      if (ch === '{') {
        depth++;
        if (depth > max) { max = depth; maxLine = i + 1; }
      } else if (ch === '}') {
        if (depth > 0) depth--;
      }
    }
  }
  return { depth: max, line: maxLine };
}

// ─── Duplicate block detection ─────────────────────────────────

function findDuplicateBlocks(lines: string[]): Finding[] {
  const findings: Finding[] = [];
  const norm = lines.map((l) => l.trim());
  const seen = new Map<string, number>(); // block key -> first line (1-based)
  const flaggedAt = new Set<number>();

  for (let i = 0; i + DUP_BLOCK_MIN <= norm.length; i++) {
    const slice = norm.slice(i, i + DUP_BLOCK_MIN);
    // Ignore blocks that are mostly blank/braces — too noisy.
    const meaningful = slice.filter((l) => l.length > 3 && l !== '}' && l !== '{').length;
    if (meaningful < DUP_BLOCK_MIN - 1) continue;

    const key = slice.join('\n');
    const first = seen.get(key);
    if (first === undefined) {
      seen.set(key, i + 1);
    } else if (!flaggedAt.has(first)) {
      flaggedAt.add(first);
      findings.push({
        type: 'duplicate-block',
        line: i + 1,
        severity: 'warning',
        message: `Bloc de ${DUP_BLOCK_MIN}+ lignes dupliqué (identique à la ligne ${first}). Candidat à l'extraction d'une fonction commune.`,
      });
    }
  }
  return findings;
}

// ─── Tool ──────────────────────────────────────────────────────

export class SuggestRefactorTool extends BaseTool {
  readonly name = 'suggest_refactor';
  readonly description =
    "Analyse un fichier source et détecte des opportunités de refactoring (fonctions trop longues, trop de paramètres, imbrication profonde, duplication, fichier trop gros, lignes trop longues). Retourne des findings localisés à raffiner par le LLM.";
  readonly category = 'analysis' as const;
  readonly riskLevel = 'low' as const;
  readonly requiresConfirmation = false;
  readonly schema = TOOL_SCHEMAS.suggest_refactor;

  async execute(args: unknown): Promise<ToolResult> {
    const { path, max_findings = 12 } = args as SuggestRefactorArgs;

    if (typeof path !== 'string' || path.trim().length === 0) {
      return this.fail('path est requis');
    }

    const ext = extname(path).toLowerCase();
    const isBrace = BRACE_LANGS.has(ext);
    const isPy = PY_EXT.has(ext);
    if (!isBrace && !isPy) {
      return this.fail(`Extension non supportée pour l'analyse de refactoring: ${ext || '(aucune)'}`);
    }

    let src: string;
    try {
      src = await readFile(path, 'utf-8');
    } catch (err) {
      return this.fail(`Impossible de lire le fichier: ${err instanceof Error ? err.message : String(err)}`);
    }

    const lines = src.split('\n');
    const findings: Finding[] = [];

    // File length
    if (lines.length > LONG_FILE) {
      findings.push({
        type: 'large-file',
        line: 1,
        severity: 'info',
        message: `Fichier de ${lines.length} lignes (> ${LONG_FILE}). Envisage de le scinder par responsabilité.`,
      });
    }

    // Long lines
    for (let i = 0; i < lines.length; i++) {
      if ((lines[i] ?? '').length > LONG_LINE) {
        findings.push({
          type: 'long-line',
          line: i + 1,
          severity: 'info',
          message: `Ligne de ${(lines[i] ?? '').length} caractères (> ${LONG_LINE}).`,
        });
      }
    }

    // Functions: length + params
    const fns = isPy ? findFunctionsPython(lines) : findFunctionsBrace(lines);
    for (const fn of fns) {
      if (fn.bodyLines > LONG_FUNCTION) {
        findings.push({
          type: 'long-function',
          line: fn.line,
          severity: 'warning',
          message: `Fonction "${fn.name}" longue de ~${fn.bodyLines} lignes (> ${LONG_FUNCTION}). Extraire des sous-fonctions.`,
        });
      }
      if (fn.params > MANY_PARAMS) {
        findings.push({
          type: 'many-params',
          line: fn.line,
          severity: 'warning',
          message: `"${fn.name}" prend ${fn.params} paramètres (> ${MANY_PARAMS}). Regrouper dans un objet/struct d'options.`,
        });
      }
    }

    // Nesting (brace languages only)
    if (isBrace) {
      const nest = maxBraceNesting(lines);
      if (nest.depth > DEEP_NESTING) {
        findings.push({
          type: 'deep-nesting',
          line: nest.line,
          severity: 'warning',
          message: `Imbrication de profondeur ${nest.depth} (> ${DEEP_NESTING}). Utiliser des early returns / extraire des fonctions.`,
        });
      }
    }

    // Duplication
    findings.push(...findDuplicateBlocks(lines));

    // Sort by line, cap, summarise
    findings.sort((a, b) => a.line - b.line);
    const capped = findings.slice(0, Math.max(1, max_findings));

    const byType: Record<string, number> = {};
    for (const f of findings) byType[f.type] = (byType[f.type] ?? 0) + 1;

    return this.ok({
      file: basename(path),
      totalLines: lines.length,
      functionsAnalyzed: fns.length,
      findingCount: findings.length,
      byType,
      findings: capped,
      truncated: findings.length > capped.length,
      note:
        findings.length === 0
          ? 'Aucun problème heuristique détecté. Le code semble raisonnablement structuré.'
          : 'Findings heuristiques — le LLM doit confirmer et proposer le refactoring concret en lisant le code aux lignes indiquées.',
    });
  }
}
