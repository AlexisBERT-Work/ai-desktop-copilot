import { readdir, readFile, stat } from 'fs/promises';
import { join, extname, relative } from 'path';
import type { ToolResult } from '@catdesk/shared-types';
import { TOOL_SCHEMAS } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';

const DEFAULT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.md', '.txt', '.rst',
  '.json', '.jsonc', '.yaml', '.yml', '.toml',
  '.py', '.rs', '.go', '.java', '.c', '.cpp', '.h',
  '.css', '.scss', '.html', '.vue', '.svelte',
  '.sh', '.ps1', '.env.example',
]);

// Directories that are never searched
const SKIP_DIRS = new Set([
  'node_modules', 'target', '.git', '__pycache__', '.venv', 'venv',
  'dist', 'build', '.next', '.nuxt', '.turbo', 'coverage', '.cache',
]);

const SNIPPET_RADIUS = 160;

interface SemanticSearchArgs {
  query: string;
  paths?: string[];
  extensions?: string[];
  limit?: number;
  max_file_size?: number;
}

interface SearchResult {
  file: string;
  score: number;
  snippet: string;
  matchCount: number;
  sizeBytes: number;
}

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/\b[a-z_][a-z0-9_]{2,}\b/g) ?? [];
}

function scoreDocument(
  content: string,
  queryTerms: string[],
): { score: number; bestPos: number; matchCount: number } {
  if (queryTerms.length === 0) return { score: 0, bestPos: -1, matchCount: 0 };

  const lower = content.toLowerCase();
  let matchCount = 0;
  let rawScore = 0;
  let bestPos = -1;

  for (const term of queryTerms) {
    let pos = lower.indexOf(term);
    while (pos !== -1) {
      matchCount++;
      rawScore += 1;
      if (bestPos === -1) bestPos = pos;
      pos = lower.indexOf(term, pos + term.length);
    }
  }

  if (matchCount === 0) return { score: 0, bestPos: -1, matchCount: 0 };

  // Proximity bonus: reward files where multiple query terms appear close together
  if (queryTerms.length >= 2) {
    const firstTerm = queryTerms[0];
    const secondTerm = queryTerms[1];
    if (firstTerm && secondTerm) {
      const p0 = lower.indexOf(firstTerm);
      const p1 = lower.indexOf(secondTerm);
      if (p0 >= 0 && p1 >= 0 && Math.abs(p0 - p1) < 200) {
        rawScore *= 1.4;
        // Use midpoint as best position for snippet
        bestPos = Math.min(p0, p1);
      }
    }
  }

  // Normalize by document length so short relevant files rank higher
  const score = rawScore / Math.log2(content.length + 4);
  return { score, bestPos, matchCount };
}

function extractSnippet(content: string, pos: number, radius: number): string {
  if (pos < 0) {
    return content.slice(0, radius * 2).replace(/\s+/g, ' ').trim();
  }
  const start = Math.max(0, pos - radius);
  const end = Math.min(content.length, pos + radius);
  let snippet = content.slice(start, end).replace(/\s+/g, ' ').trim();
  if (start > 0) snippet = '…' + snippet;
  if (end < content.length) snippet = snippet + '…';
  return snippet;
}

async function walkDir(
  dir: string,
  exts: Set<string>,
  maxSize: number,
  depth = 0,
): Promise<string[]> {
  if (depth > 10) return [];
  const results: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const sub = await walkDir(full, exts, maxSize, depth + 1);
      results.push(...sub);
    } else if (entry.isFile() && exts.has(extname(entry.name).toLowerCase())) {
      try {
        const s = await stat(full);
        if (s.size <= maxSize) results.push(full);
      } catch {
        // inaccessible — skip
      }
    }
  }
  return results;
}

export class SemanticSearchTool extends BaseTool {
  readonly name = 'semantic_search';
  readonly description = 'Cherche dans les fichiers locaux par similarité de contenu (keyword scoring). Retourne les fichiers les plus pertinents avec un extrait du passage correspondant.';
  readonly category = 'filesystem' as const;
  readonly riskLevel = 'low' as const;
  readonly requiresConfirmation = false;
  readonly schema = TOOL_SCHEMAS.semantic_search;

  async execute(rawArgs: unknown): Promise<ToolResult> {
    const args = rawArgs as SemanticSearchArgs;
    const { query, limit = 10, max_file_size = 500_000 } = args;

    if (!query?.trim()) return this.fail('query est requis');

    const searchPaths = (args.paths?.length ?? 0) > 0
      ? (args.paths as string[])
      : [process.cwd()];

    const exts = (args.extensions?.length ?? 0) > 0
      ? new Set((args.extensions as string[]).map(e => e.startsWith('.') ? e : `.${e}`))
      : DEFAULT_EXTENSIONS;

    const queryTerms = tokenize(query);
    if (queryTerms.length === 0) return this.fail('La requête ne contient aucun terme exploitable');

    // Collect all candidate files
    const allFiles: string[] = [];
    for (const dir of searchPaths) {
      const found = await walkDir(dir, exts, max_file_size);
      allFiles.push(...found);
    }

    if (allFiles.length === 0) {
      return this.ok({ query, results: [], totalScanned: 0, message: 'Aucun fichier trouvé dans les chemins spécifiés' });
    }

    // Score each file
    const scored: SearchResult[] = [];
    for (const file of allFiles) {
      let content: string;
      try {
        content = await readFile(file, 'utf-8');
      } catch {
        continue;
      }
      const { score, bestPos, matchCount } = scoreDocument(content, queryTerms);
      if (score > 0) {
        scored.push({
          file,
          score,
          snippet: extractSnippet(content, bestPos, SNIPPET_RADIUS),
          matchCount,
          sizeBytes: Buffer.byteLength(content),
        });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, limit);

    // Make paths relative for readability
    const cwd = process.cwd();
    const results = top.map(r => ({
      file: (() => { try { return relative(cwd, r.file); } catch { return r.file; } })(),
      absolutePath: r.file,
      score: Math.round(r.score * 1000) / 1000,
      matchCount: r.matchCount,
      snippet: r.snippet,
      sizeBytes: r.sizeBytes,
    }));

    return this.ok({
      query,
      queryTerms,
      results,
      totalScanned: allFiles.length,
      totalMatched: scored.length,
    });
  }
}
