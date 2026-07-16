import { z } from 'zod';
import { readFile } from 'fs/promises';
import type { ToolResult } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { jsonSchemaFrom } from '../base/zodSchema';

const argsSchema = z.object({
  path: z.string().min(1).describe('Absolute path to a local log file'),
  max_lines: z.number().max(100000).default(5000).describe('Analyze only the last N lines'),
  pattern: z
    .string()
    .optional()
    .describe('Keep only lines containing this text (case-insensitive) before analyzing'),
  top_errors: z.number().default(10).describe('Number of grouped error clusters to return'),
});
type Args = z.infer<typeof argsSchema>;

export type LogLevel = 'FATAL' | 'ERROR' | 'WARN' | 'INFO' | 'DEBUG' | 'TRACE';

const LEVEL_RE = /\b(FATAL|ERROR|WARN(?:ING)?|INFO|DEBUG|TRACE)\b/i;
// ISO-8601-ish timestamp anywhere near the start of a line.
const TS_RE = /\b(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d{1,6})?(?:Z|[+-]\d{2}:?\d{2})?)\b/;

/** Detect the log level of a line, or null when none is present. */
export function detectLevel(line: string): LogLevel | null {
  const m = LEVEL_RE.exec(line);
  if (!m) return null;
  const raw = m[1]!.toUpperCase();
  return raw === 'WARNING' ? 'WARN' : (raw as LogLevel);
}

/** Extract the first timestamp-looking token from a line, or null. */
export function extractTimestamp(line: string): string | null {
  return TS_RE.exec(line)?.[1] ?? null;
}

/**
 * Normalize a line so near-identical errors collapse into one group:
 * strip timestamps, numbers, hex/uuids, quoted strings and excess whitespace.
 */
export function normalizeLogLine(line: string): string {
  return line
    .replace(TS_RE, '<ts>')
    .replace(/0x[0-9a-fA-F]+/g, '<hex>')
    .replace(/\b[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}\b/g, '<uuid>')
    .replace(/"[^"]*"|'[^']*'/g, '<str>')
    .replace(/\b\d+\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim();
}

interface ErrorGroup {
  count: number;
  sample: string;
  normalized: string;
}

export interface LogAnalysis {
  linesAnalyzed: number;
  levelCounts: Record<string, number>;
  timeRange: { first: string; last: string } | null;
  topErrors: ErrorGroup[];
  recentErrors: string[];
}

/** Analyze already-split log lines. Pure — the unit-tested core. */
export function analyzeLogLines(lines: string[], topErrors = 10): LogAnalysis {
  const levelCounts: Record<string, number> = {};
  const groups = new Map<string, ErrorGroup>();
  const recentErrors: string[] = [];
  let first: string | null = null;
  let last: string | null = null;

  for (const line of lines) {
    if (!line.trim()) continue;

    const ts = extractTimestamp(line);
    if (ts) {
      first ??= ts;
      last = ts;
    }

    const level = detectLevel(line) ?? 'OTHER';
    levelCounts[level] = (levelCounts[level] ?? 0) + 1;

    if (level === 'ERROR' || level === 'FATAL') {
      const key = normalizeLogLine(line);
      const existing = groups.get(key);
      if (existing) existing.count += 1;
      else
        groups.set(key, {
          count: 1,
          sample: line.trim().slice(0, 300),
          normalized: key.slice(0, 200),
        });

      recentErrors.push(line.trim().slice(0, 300));
      if (recentErrors.length > 5) recentErrors.shift();
    }
  }

  const top = [...groups.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, Math.max(1, topErrors));

  return {
    linesAnalyzed: lines.filter(l => l.trim()).length,
    levelCounts,
    timeRange: first && last ? { first, last } : null,
    topErrors: top,
    recentErrors,
  };
}

/**
 * Analyze a local log file: counts per level, grouped recurring errors, the
 * observed time range and the most recent errors. Fully local, read-only.
 */
export class AnalyzeLogsTool extends BaseTool<Args> {
  readonly name = 'analyze_logs';
  readonly description =
    'Analyse un fichier de log local : comptage par niveau (ERROR/WARN/INFO…), regroupement des erreurs récurrentes similaires (top N), plage temporelle détectée et dernières erreurs. Lecture seule, 100% local. Filtre optionnel par motif (pattern), analyse des dernières max_lines lignes.';
  readonly category = 'analysis' as const;
  readonly riskLevel = 'low' as const;
  readonly requiresConfirmation = false;
  override readonly argsSchema = argsSchema;
  readonly schema = jsonSchemaFrom(argsSchema);

  async execute(rawArgs: Args): Promise<ToolResult> {
    const { path, max_lines = 5000, pattern, top_errors = 10 } = rawArgs;

    if (!path?.trim()) return this.fail('path est requis.');

    let content: string;
    try {
      content = await readFile(path, 'utf-8');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/ENOENT|no such file/i.test(msg)) return this.fail(`Fichier introuvable : ${path}`);
      if (/EISDIR/i.test(msg)) return this.fail(`${path} est un dossier, pas un fichier de log.`);
      return this.fail(`Lecture impossible : ${msg}`);
    }

    let lines = content.split(/\r?\n/);

    if (pattern?.trim()) {
      const needle = pattern.toLowerCase();
      lines = lines.filter(l => l.toLowerCase().includes(needle));
    }

    const cap = Math.min(Math.max(max_lines, 1), 100_000);
    const truncated = lines.length > cap;
    if (truncated) lines = lines.slice(-cap);

    const analysis = analyzeLogLines(lines, top_errors);
    return this.ok({ path, truncated, ...analysis });
  }
}
