import { z } from 'zod';
import { readdir, readFile, stat } from 'fs/promises';
import { basename, extname, join, relative } from 'path';
import type { ToolResult } from '@catdesk/shared-types';
import { DEFAULT_PERMISSION_CONFIG } from '@catdesk/shared-types';
import { createLogger } from '../../logger';
import {
  KENSAKU_MAX_RESULTS,
  KensakuBackend,
  type KensakuSearch,
} from '../../search/kensakuBackend';
import {
  createScopeCheck,
  defaultSearchRoots,
  keepInScope,
  type ScopeCheck,
} from '../../search/scope';
import { BaseTool } from '../base/BaseTool';
import { jsonSchemaFrom } from '../base/zodSchema';

const log = createLogger('tools:semantic_search');

const DEFAULT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.md',
  '.txt',
  '.rst',
  '.json',
  '.jsonc',
  '.yaml',
  '.yml',
  '.toml',
  '.py',
  '.rs',
  '.go',
  '.java',
  '.c',
  '.cpp',
  '.h',
  '.css',
  '.scss',
  '.html',
  '.vue',
  '.svelte',
  '.sh',
  '.ps1',
  '.env.example',
]);

// Directories that are never searched
const SKIP_DIRS = new Set([
  'node_modules',
  'target',
  '.git',
  '__pycache__',
  '.venv',
  'venv',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.turbo',
  'coverage',
  '.cache',
]);

const SNIPPET_RADIUS = 160;

const argsSchema = z.object({
  query: z.string().min(1).describe('What to search for in local files'),
  paths: z
    .array(z.string())
    .optional()
    .describe(
      'Only folders the user named. Omit otherwise: Documents, Desktop and Downloads are searched. Never guess a path.',
    ),
  extensions: z
    .array(z.string())
    .optional()
    .describe(
      'File extensions to include, e.g. [".ts", ".md"] (defaults to common text/code types)',
    ),
  limit: z.number().default(10).describe('Max results to return'),
  max_file_size: z.number().default(500000).describe('Skip files larger than this size in bytes'),
});
type Args = z.infer<typeof argsSchema>;

/**
 * Mots grammaticaux d'une demande en français : ils sont dans presque tous les
 * fichiers, et noyaient le score des mots qui comptent.
 */
const QUERY_STOPWORDS = new Set(
  (
    'les des une aux dans pour par sur sous avec sans qui que quoi dont est sont ' +
    'mon mes ton tes son ses notre nos votre vos leur leurs ces cet cette pas plus ' +
    'tout tous toute toutes the and for with'
  ).split(' '),
);

/**
 * Termes d'une requête, lettres de toutes les langues : avant, `[a-z]` seul
 * coupait « réunion » en « union » et perdait « été ».
 */
export function tokenize(text: string): string[] {
  const words = text.toLowerCase().match(/[\p{L}_][\p{L}\p{N}_]{2,}/gu) ?? [];
  return [...new Set(words.filter(w => !QUERY_STOPWORDS.has(w)))];
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
    return content
      .slice(0, radius * 2)
      .replace(/\s+/g, ' ')
      .trim();
  }
  const start = Math.max(0, pos - radius);
  const end = Math.min(content.length, pos + radius);
  let snippet = content.slice(start, end).replace(/\s+/g, ' ').trim();
  if (start > 0) snippet = '…' + snippet;
  if (end < content.length) snippet = snippet + '…';
  return snippet;
}

/**
 * Plafond de fichiers candidats par recherche. Sans lui, `paths: ["C:/"]`
 * parcourait — et lisait — tout le disque.
 */
const MAX_FILES = 5_000;

/** Extension utile : `extname('.env.example')` vaut '.example', pas '.env.example'. */
function fileExtension(name: string): string {
  return name === '.env.example' ? '.env.example' : extname(name).toLowerCase();
}

/**
 * Fichiers candidats, par leur nom seulement : la taille est lue avec le
 * contenu, en parallèle (`scoreFiles`). Une jonction ou un lien n'est pas un
 * dossier pour `readdir` : il n'est pas suivi.
 */
async function walkDir(
  dir: string,
  exts: Set<string>,
  results: string[] = [],
  depth = 0,
): Promise<string[]> {
  if (depth > 10 || results.length >= MAX_FILES) return results;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (results.length >= MAX_FILES) break;
    if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) await walkDir(full, exts, results, depth + 1);
    } else if (entry.isFile() && exts.has(fileExtension(entry.name))) {
      results.push(full);
    }
  }
  return results;
}

interface SearchHit {
  path: string;
  score: number;
  snippet: string;
  matchCount: number;
  sizeBytes: number | null;
  matchType?: string | null;
}

/**
 * Lectures simultanées. Sans paralléliser, lire 5 000 fichiers des dossiers par
 * défaut prenait ~3,2 s sur le poste de référence, ~0,7 s à 16.
 */
const READ_CONCURRENCY = 16;

/** Lit et note chaque fichier d'au plus `maxSize` octets ; `read` : fichiers lus. */
async function scoreFiles(
  files: readonly string[],
  queryTerms: string[],
  maxSize: number,
): Promise<{ hits: SearchHit[]; read: number }> {
  const hits: SearchHit[] = [];
  let read = 0;
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < files.length) {
      const file = files[next++] as string;
      let content: string;
      try {
        if ((await stat(file)).size > maxSize) continue;
        content = await readFile(file, 'utf-8');
      } catch {
        continue; // inaccessible
      }
      read++;
      const { score, bestPos, matchCount } = scoreDocument(content, queryTerms);
      if (score > 0) {
        hits.push({
          path: file,
          score,
          snippet: extractSnippet(content, bestPos, SNIPPET_RADIUS),
          matchCount,
          sizeBytes: Buffer.byteLength(content),
        });
      }
    }
  };
  await Promise.all(Array.from({ length: READ_CONCURRENCY }, worker));
  // Ordre d'arrivée variable : on départage par chemin, pour un résultat stable.
  hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return { hits, read };
}

export interface SemanticSearchOptions {
  /** Moteur Kensaku ; `null` : mots-clés seulement (tests). */
  kensaku?: KensakuSearch | null;
  /**
   * Liste blanche des chemins. Celle par défaut, faute de réglage : aucun écran
   * ne la modifie aujourd'hui (`settings.update` ne porte que `safeMode`).
   */
  pathWhitelist?: () => readonly string[];
}

/** Chemin lisible (relatif au dossier courant, comme avant), plus le chemin absolu. */
function presentHit(hit: SearchHit, realPath: string): Record<string, unknown> {
  let file = realPath;
  try {
    file = relative(process.cwd(), realPath);
  } catch {
    // lecteur différent : on garde le chemin absolu
  }
  return {
    file,
    absolutePath: realPath,
    score: Math.round(hit.score * 1000) / 1000,
    matchCount: hit.matchCount,
    snippet: hit.snippet,
    sizeBytes: hit.sizeBytes,
    ...(hit.matchType ? { matchType: hit.matchType } : {}),
  };
}

/** Termes de la requête présents dans l'extrait (Kensaku ne compte pas). */
function countTerms(text: string, terms: readonly string[]): number {
  const lower = text.toLowerCase();
  return terms.filter(term => lower.includes(term)).length;
}

export class SemanticSearchTool extends BaseTool<Args> {
  readonly name = 'semantic_search';
  readonly description =
    'Retrouve un fichier local d’après ce qu’il contient, PDF et captures d’écran compris. Renvoie les plus pertinents avec un extrait.';
  readonly category = 'filesystem' as const;
  readonly riskLevel = 'low' as const;
  readonly requiresConfirmation = false;
  override readonly argsSchema = argsSchema;
  override readonly pathArgs = ['paths'] as const;
  readonly schema = jsonSchemaFrom(argsSchema);

  private readonly kensaku: KensakuSearch | null;
  private readonly whitelist: () => readonly string[];

  constructor(options: SemanticSearchOptions = {}) {
    super();
    this.kensaku = options.kensaku === undefined ? new KensakuBackend() : options.kensaku;
    this.whitelist = options.pathWhitelist ?? (() => DEFAULT_PERMISSION_CONFIG.pathWhitelist);
  }

  async execute(args: Args): Promise<ToolResult> {
    const { query, limit = 10, max_file_size = 500_000 } = args;
    if (!query?.trim()) return this.fail('query est requis');

    const whitelist = this.whitelist();
    const requested = args.paths ?? [];
    // Sans chemin : les dossiers de la liste blanche (avant : `process.cwd()`,
    // le dossier de l'agent, hors liste blanche).
    const roots = requested.length > 0 ? requested : defaultSearchRoots(whitelist);
    const explicitExts =
      (args.extensions?.length ?? 0) > 0
        ? new Set((args.extensions as string[]).map(e => (e.startsWith('.') ? e : `.${e}`)))
        : null;
    const queryTerms = tokenize(query);
    // Chaque résultat, des deux moteurs, est résolu (jonctions) puis revérifié.
    const inScope = await createScopeCheck(roots, whitelist);

    const viaKensaku = await this.searchKensaku(
      query,
      queryTerms,
      roots,
      explicitExts,
      limit,
      inScope,
    );
    if (viaKensaku !== null) return viaKensaku;

    if (queryTerms.length === 0) return this.fail('La requête ne contient aucun terme exploitable');
    return this.searchKeywords(
      query,
      queryTerms,
      roots,
      explicitExts ?? DEFAULT_EXTENSIONS,
      max_file_size,
      limit,
      inScope,
    );
  }

  /**
   * Kensaku d'abord. `null` : il n'a pas servi (absent, refusé, en échec), ou
   * rien de ce qu'il a trouvé n'est dans le périmètre (un dossier qu'il
   * n'indexe pas, par exemple) : l'ancien moteur prend alors le relais.
   *
   * `max_file_size` ne s'applique pas : il borne ce que l'ancien moteur LIT, et
   * ici rien n'est lu ; il écarterait les PDF, la raison d'être de Kensaku. Les
   * extensions ne filtrent que si le modèle les a données.
   */
  private async searchKensaku(
    query: string,
    queryTerms: readonly string[],
    roots: readonly string[],
    exts: Set<string> | null,
    limit: number,
    inScope: ScopeCheck,
  ): Promise<ToolResult | null> {
    if (this.kensaku === null) return null;
    const onlyRoot = roots.length === 1 ? roots[0] : undefined;
    const outcome = await this.kensaku.search(query, {
      limit: KENSAKU_MAX_RESULTS,
      ...(onlyRoot !== undefined ? { scope: onlyRoot } : {}),
    });
    if (!outcome.ok) return null;

    const candidates =
      exts === null
        ? outcome.hits
        : outcome.hits.filter(h => exts.has(fileExtension(basename(h.path))));
    const { kept, dropped } = await keepInScope(candidates, h => h.path, inScope, limit);
    if (kept.length === 0) {
      if (outcome.hits.length > 0) {
        log.info('Kensaku : rien dans le périmètre, moteur par mots-clés', {
          found: outcome.hits.length,
        });
      }
      return null;
    }

    return this.ok({
      query,
      engine: 'kensaku',
      results: kept.map(({ item, realPath }) =>
        presentHit({ ...item, matchCount: countTerms(item.snippet, queryTerms) }, realPath),
      ),
      totalMatched: outcome.total ?? candidates.length,
      ...(dropped > 0 ? { outOfScope: dropped } : {}),
    });
  }

  private async searchKeywords(
    query: string,
    queryTerms: string[],
    roots: readonly string[],
    exts: Set<string>,
    maxFileSize: number,
    limit: number,
    inScope: ScopeCheck,
  ): Promise<ToolResult> {
    const allFiles: string[] = [];
    for (const dir of roots) {
      await walkDir(dir, exts, allFiles);
    }

    if (allFiles.length === 0) {
      return this.ok({
        query,
        engine: 'keywords',
        results: [],
        totalScanned: 0,
        message: 'Aucun fichier trouvé dans les chemins spécifiés',
      });
    }

    const { hits: scored, read } = await scoreFiles(allFiles, queryTerms, maxFileSize);
    const { kept, dropped } = await keepInScope(scored, h => h.path, inScope, limit);

    return this.ok({
      query,
      engine: 'keywords',
      queryTerms,
      results: kept.map(({ item, realPath }) => presentHit(item, realPath)),
      totalScanned: read,
      totalMatched: scored.length,
      ...(dropped > 0 ? { outOfScope: dropped } : {}),
    });
  }
}
