import type { ToolResult } from '@catdesk/shared-types';
import { TOOL_SCHEMAS } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';

// ─── Types ─────────────────────────────────────────────────────

interface StackFrame {
  raw: string;
  file?: string;
  line?: number;
  column?: number;
  functionName?: string;
  isInternal: boolean;
}

interface AnalysisResult {
  language: string;
  errorType: string;
  errorMessage: string;
  frames: StackFrame[];
  userFrames: StackFrame[];
  rootCauseFrame: StackFrame | null;
  totalFrames: number;
  context?: string;
}

interface StacktraceArgs {
  stacktrace: string;
  context?: string;
}

// ─── Runtime detection ─────────────────────────────────────────

function detectLanguage(s: string): string {
  if (/Traceback \(most recent call last\)/i.test(s)) return 'python';
  if (/thread '.+' panicked/i.test(s)) return 'rust';
  if (/^\s+at [a-zA-Z0-9_.$]+\([A-Z][a-zA-Z0-9]+\.(?:java|kt):\d+\)/m.test(s)) return 'java';
  if (/^\s+at .+\.(?:ts|tsx):\d+:\d+/m.test(s)) return 'typescript';
  if (/^\s+at .+\(https?:\/\//m.test(s)) return 'browser-js';
  if (/^\s+at .+ \(.+:\d+:\d+\)/m.test(s) || /^\s+at .+:\d+:\d+$/m.test(s)) return 'nodejs';
  return 'unknown';
}

// ─── Internal frame detection ──────────────────────────────────

const INTERNAL: Record<string, RegExp[]> = {
  nodejs: [/node_modules[\\/]/, /node:internal\//, /\(node:/, /^internal\//, /timers\.js/, /events\.js/],
  typescript: [/node_modules[\\/]/, /node:internal\//, /\(node:/],
  python: [/site-packages[\\/]/, /\/lib\/python/, /importlib/, /<frozen /],
  java: [/^java\./, /^javax\./, /^sun\./, /^com\.sun\./, /^org\.springframework\./],
  'browser-js': [/https?:\/\/(?!localhost)/, /webpack-internal:\/\//],
};

function isInternal(file: string, lang: string): boolean {
  const patterns = INTERNAL[lang] ?? INTERNAL['nodejs'] ?? [];
  return patterns.some(p => p.test(file));
}

// ─── Per-runtime parsers ───────────────────────────────────────

function parseNodeish(stacktrace: string, lang: string): Omit<AnalysisResult, 'language' | 'userFrames' | 'rootCauseFrame' | 'totalFrames'> {
  const lines = stacktrace.trim().split('\n');
  const firstLine = lines[0] ?? '';

  const errMatch = firstLine.match(/^([A-Za-z][\w.]*(?:Error|Exception|Fault)?\b):? (.+)$/) ??
                   firstLine.match(/^([A-Za-z][\w.]*):(.+)$/);
  const errorType = errMatch?.[1]?.trim() ?? 'Error';
  const errorMessage = errMatch?.[2]?.trim() ?? firstLine;

  const frames: StackFrame[] = [];
  // "    at funcName (file:line:col)" or "    at file:line:col"
  const re = /^\s+at (?:(.+?) \((.+?):(\d+):(\d+)\)|(.+?):(\d+):(\d+))\s*$/;

  for (const line of lines.slice(1)) {
    const m = line.match(re);
    if (m === null) continue;

    const functionName = m[1] ?? '<anonymous>';
    const file = m[2] ?? m[5] ?? '';
    const lineNum = parseInt(m[3] ?? m[6] ?? '0', 10);
    const col = parseInt(m[4] ?? m[7] ?? '0', 10);

    frames.push({ raw: line.trim(), functionName, file, line: lineNum, column: col, isInternal: isInternal(file, lang) });
  }

  return { errorType, errorMessage, frames };
}

function parsePython(stacktrace: string): Omit<AnalysisResult, 'language' | 'userFrames' | 'rootCauseFrame' | 'totalFrames'> {
  const lines = stacktrace.trim().split('\n');

  // Last non-indented, non-empty line is "ErrorType: message"
  const lastLine = [...lines].reverse().find(l => l.trim().length > 0 && !l.startsWith(' ')) ?? '';
  const errMatch = lastLine.match(/^([\w.]+(?:Error|Exception|Warning)[\w]*):?\s*(.*)$/) ??
                   lastLine.match(/^([\w.]+):\s*(.+)$/);
  const errorType = errMatch?.[1] ?? 'Exception';
  const errorMessage = errMatch?.[2]?.trim() ?? lastLine;

  const frames: StackFrame[] = [];
  const re = /^\s+File "(.+?)", line (\d+), in (.+)$/;

  for (const line of lines) {
    const m = line.match(re);
    if (m === null) continue;
    const file = m[1] ?? '';
    const lineNum = parseInt(m[2] ?? '0', 10);
    const functionName = m[3] ?? '';
    frames.push({ raw: line.trim(), file, line: lineNum, functionName, isInternal: isInternal(file, 'python') });
  }

  return { errorType, errorMessage, frames };
}

function parseRust(stacktrace: string): Omit<AnalysisResult, 'language' | 'userFrames' | 'rootCauseFrame' | 'totalFrames'> {
  const panicMatch = stacktrace.match(/thread '(.+?)' panicked at '(.+?)',\s*(.+?):(\d+)/s) ??
                     stacktrace.match(/thread '(.+?)' panicked at (.+?):(\d+):\d+[\s\n]+'(.+?)'/s);
  const errorMessage = panicMatch?.[2]?.trim() ?? panicMatch?.[4]?.trim() ?? 'panic';

  const frames: StackFrame[] = [];
  const re = /^\s*\d+:\s+(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stacktrace)) !== null) {
    const fn = m[1]?.trim();
    frames.push({
      raw: m[0].trim(),
      ...(fn !== undefined ? { functionName: fn } : {}),
      isInternal: /std::|core::|alloc::/.test(fn ?? ''),
    });
  }

  return { errorType: 'panic', errorMessage, frames };
}

function parseJava(stacktrace: string): Omit<AnalysisResult, 'language' | 'userFrames' | 'rootCauseFrame' | 'totalFrames'> {
  const lines = stacktrace.trim().split('\n');
  const firstLine = lines[0] ?? '';
  const errMatch = firstLine.match(/^([\w.]+(?:Exception|Error)[\w]*): (.+)$/) ??
                   firstLine.match(/^([\w.]+): (.+)$/);
  const errorType = errMatch?.[1] ?? 'Exception';
  const errorMessage = errMatch?.[2] ?? firstLine;

  const frames: StackFrame[] = [];
  const re = /^\s+at ([\w$.]+)\(([\w$.]+\.(?:java|kt)):(\d+)\)\s*$/;

  for (const line of lines.slice(1)) {
    const m = line.match(re);
    if (m === null) continue;
    const functionName = m[1] ?? '';
    const file = m[2] ?? '';
    const lineNum = parseInt(m[3] ?? '0', 10);
    frames.push({ raw: line.trim(), functionName, file, line: lineNum, isInternal: isInternal(functionName, 'java') });
  }

  return { errorType, errorMessage, frames };
}

// ─── Root cause heuristic ──────────────────────────────────────

function findRootCause(frames: StackFrame[], lang: string): StackFrame | null {
  const user = frames.filter(f => !f.isInternal);
  if (lang === 'python') {
    // Innermost (last) user frame is where the error occurred
    return user[user.length - 1] ?? frames[frames.length - 1] ?? null;
  }
  // For JS/TS/Java: first user frame is the throw site
  return user[0] ?? frames[0] ?? null;
}

// ─── Tool ──────────────────────────────────────────────────────

export class AnalyzeStacktraceTool extends BaseTool {
  readonly name = 'analyze_stacktrace';
  readonly description = "Analyse une stacktrace pour extraire le type d'erreur, le message et les frames clés";
  readonly category = 'analysis' as const;
  readonly riskLevel = 'low' as const;
  readonly requiresConfirmation = false;
  readonly schema = TOOL_SCHEMAS.analyze_stacktrace;

  async execute(args: unknown): Promise<ToolResult> {
    const { stacktrace, context } = args as StacktraceArgs;

    if (typeof stacktrace !== 'string' || stacktrace.trim().length === 0) {
      return this.fail('stacktrace est requis et ne peut pas être vide');
    }

    const trimmed = stacktrace.trim();
    const language = detectLanguage(trimmed);

    let parsed: Omit<AnalysisResult, 'language' | 'userFrames' | 'rootCauseFrame' | 'totalFrames'>;
    switch (language) {
      case 'python':    parsed = parsePython(trimmed); break;
      case 'rust':      parsed = parseRust(trimmed); break;
      case 'java':      parsed = parseJava(trimmed); break;
      default:          parsed = parseNodeish(trimmed, language); break;
    }

    const userFrames = parsed.frames.filter(f => !f.isInternal);
    const rootCauseFrame = findRootCause(parsed.frames, language);

    const result: AnalysisResult = {
      language,
      errorType: parsed.errorType,
      errorMessage: parsed.errorMessage,
      frames: parsed.frames,
      userFrames,
      rootCauseFrame,
      totalFrames: parsed.frames.length,
      ...(typeof context === 'string' && context.length > 0 ? { context } : {}),
    };

    return this.ok(result);
  }
}
