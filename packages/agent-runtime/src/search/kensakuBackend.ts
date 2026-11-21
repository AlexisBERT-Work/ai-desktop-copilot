import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { runProcess, type RunProcessOptions } from '../lib/runProcess';
import { createLogger } from '../logger';

/**
 * Kensaku (github.com/yjid/kensaku, MIT) comme moteur de `semantic_search` :
 * noms, texte des PDF/Office, texte des images (OCR) et sens, dans un index
 * local que l'application Kensaku tient à jour. CatDesk n'appelle que son CLI,
 * en lecture seule, et n'installe rien : c'est l'utilisateur qui pose le
 * binaire (`scripts/fetch-kensaku.ps1`).
 *
 * Absent, inconnu ou en échec, on revient à l'ancien moteur par mots-clés :
 * Kensaku est un bonus, jamais une dépendance.
 */

const log = createLogger('search:kensaku');

/**
 * Empreintes SHA-256 acceptées de `kensaku-cli-windows-x86_64.exe`, relevées
 * dans le `SHA256SUMS` de chaque release et recoupées avec l'API GitHub. Rien
 * avant 1.0.16 : elle corrige une lecture de fichier arbitraire par MCP
 * (`read_snippet`). Un binaire dont l'empreinte n'est pas ici n'est jamais lancé.
 * Nouvelle version : ajouter sa ligne, après avoir lu ses notes de version.
 */
export const KENSAKU_PINNED: Readonly<Record<string, string>> = {
  c82a306648fbe4fee541a0ff781a872d8b28f489a99a3c668cd73d686e4322e4: '1.0.17',
  '3fa9ef4721f3d7aafd275f552a1d4a5a1183403891302606f1f4dea787bf1ce0': '1.0.16',
};

/** Plafond de Kensaku (`page_size` de 1 à 50). */
export const KENSAKU_MAX_RESULTS = 50;

/** Un appel unique paie le chargement des métadonnées de l'index : large, mais borné. */
const TIMEOUT_MS = 10_000;
const MAX_OUTPUT = 2_000_000;

/** Où chercher le CLI : `CATDESK_KENSAKU_CLI`, sinon `%LOCALAPPDATA%\nd-kensaku`. */
export function kensakuCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const explicit = env['CATDESK_KENSAKU_CLI']?.trim();
  if (explicit) return [explicit];
  const local = env['LOCALAPPDATA']?.trim();
  if (!local) return [];
  const dir = join(local, 'nd-kensaku');
  return [join(dir, 'kensaku-cli.exe'), join(dir, 'kensaku-cli-windows-x86_64.exe')];
}

export interface KensakuHit {
  path: string;
  score: number;
  snippet: string;
  /** `FileName`, `Content`, `ContentFolded`, `Semantic` ou `Both`. */
  matchType: string | null;
  sizeBytes: number | null;
}

/** Pourquoi Kensaku n'a pas servi (l'ancien moteur prend alors le relais). */
export type KensakuSkip = 'absent' | 'untrusted' | 'no_index' | 'failed' | 'bad_output';

export type KensakuOutcome =
  | { ok: true; hits: KensakuHit[]; total: number | null; version: string }
  | { ok: false; reason: KensakuSkip; detail: string };

export interface KensakuQuery {
  limit: number;
  /** Un dossier : devient `--path`, Kensaku cherche alors seulement dessous. */
  scope?: string;
}

export interface KensakuSearch {
  search(query: string, options: KensakuQuery): Promise<KensakuOutcome>;
}

export interface KensakuDeps {
  candidates: () => string[];
  stat: (path: string) => Promise<{ mtimeMs: number; size: number } | null>;
  sha256: (path: string) => Promise<string>;
  run: (
    program: string,
    args: string[],
    opts: RunProcessOptions,
  ) => Promise<{ stdout: string; stderr: string }>;
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

const DEFAULT_DEPS: KensakuDeps = {
  candidates: () => kensakuCandidates(),
  stat: async path => {
    try {
      const s = await stat(path);
      return s.isFile() ? { mtimeMs: s.mtimeMs, size: s.size } : null;
    } catch {
      return null;
    }
  },
  sha256: sha256File,
  run: runProcess,
};

const hitSchema = z.object({
  path: z.string().min(1),
  score: z.number().optional(),
  snippet: z.string().optional(),
  match_type: z.string().optional(),
  size: z.number().optional(),
});
const responseSchema = z.object({
  results: z.array(z.unknown()),
  total: z.number().optional(),
});

/** Réponse `--json` → résultats. Une entrée mal formée est ignorée, pas fatale. */
export function parseKensakuOutput(
  stdout: string,
): { hits: KensakuHit[]; total: number | null } | null {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    return null;
  }
  const parsed = responseSchema.safeParse(raw);
  if (!parsed.success) return null;
  const hits = parsed.data.results.flatMap(entry => {
    const hit = hitSchema.safeParse(entry);
    if (!hit.success) return [];
    const { path, score, snippet, match_type, size } = hit.data;
    return [
      {
        path,
        score: score ?? 0,
        snippet: snippet ?? '',
        matchType: match_type ?? null,
        sizeBytes: size ?? null,
      },
    ];
  });
  return { hits, total: parsed.data.total ?? null };
}

function errorField(error: unknown, key: string): unknown {
  return typeof error === 'object' && error !== null
    ? (error as Record<string, unknown>)[key]
    : undefined;
}

/** Échec de `execFile` → raison. Code 3 : pas d'index (Kensaku jamais lancé). */
function classifyFailure(error: unknown): { reason: KensakuSkip; detail: string } {
  const code = errorField(error, 'code');
  if (code === 3) {
    return { reason: 'no_index', detail: "pas d'index : lancer l'application Kensaku une fois" };
  }
  if (errorField(error, 'killed') === true) {
    return { reason: 'failed', detail: `délai de ${TIMEOUT_MS / 1000} s dépassé` };
  }
  const stderr = errorField(error, 'stderr');
  const tail = typeof stderr === 'string' ? stderr.trim().slice(0, 200) : '';
  return { reason: 'failed', detail: `code ${String(code ?? '?')}${tail ? ` : ${tail}` : ''}` };
}

interface Verdict {
  mtimeMs: number;
  size: number;
  version: string | null;
}

export class KensakuBackend implements KensakuSearch {
  private readonly deps: KensakuDeps;
  /** Empreinte vérifiée par chemin, tant que date et taille ne bougent pas. */
  private readonly verdicts = new Map<string, Verdict>();
  /** Raisons déjà journalisées : une fois chacune, tant qu'aucun appel ne réussit. */
  private readonly reported = new Set<string>();
  /** Le dernier appel a réussi (son passage est journalisé une fois). */
  private inUse = false;

  constructor(deps: Partial<KensakuDeps> = {}) {
    this.deps = { ...DEFAULT_DEPS, ...deps };
  }

  /**
   * Le premier CLI présent, s'il est épinglé. Le haché d'un binaire de ~25 Mo
   * coûte ~100 ms : il n'est refait que si sa date ou sa taille change.
   */
  async locate(): Promise<
    { path: string; version: string } | { skip: KensakuSkip; detail: string }
  > {
    for (const path of this.deps.candidates()) {
      const info = await this.deps.stat(path);
      if (info === null) continue;
      let verdict = this.verdicts.get(path);
      if (verdict?.mtimeMs !== info.mtimeMs || verdict.size !== info.size) {
        const digest = await this.deps.sha256(path).catch(() => '');
        verdict = { ...info, version: KENSAKU_PINNED[digest.toLowerCase()] ?? null };
        this.verdicts.set(path, verdict);
      }
      if (verdict.version === null) {
        return { skip: 'untrusted', detail: `empreinte inconnue, non lancé : ${path}` };
      }
      return { path, version: verdict.version };
    }
    return { skip: 'absent', detail: 'kensaku-cli introuvable' };
  }

  async search(query: string, options: KensakuQuery): Promise<KensakuOutcome> {
    const located = await this.locate();
    if ('skip' in located) return this.skip(located.skip, located.detail);

    const limit = Math.max(1, Math.min(KENSAKU_MAX_RESULTS, Math.floor(options.limit)));
    // Sans shell (execFile) ; `--` avant la requête : une requête qui commence
    // par un tiret (« -brouillon », négation dans Kensaku) n'est pas une option.
    const args = [
      'search',
      '--json',
      '--limit',
      String(limit),
      ...(options.scope !== undefined ? ['--path', options.scope] : []),
      '--',
      query,
    ];

    let stdout: string;
    try {
      ({ stdout } = await this.deps.run(located.path, args, {
        timeoutMs: TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT,
      }));
    } catch (error) {
      const { reason, detail } = classifyFailure(error);
      return this.skip(reason, detail);
    }

    const parsed = parseKensakuOutput(stdout);
    if (parsed === null) return this.skip('bad_output', 'sortie --json illisible');

    if (!this.inUse) {
      this.inUse = true;
      this.reported.clear();
      log.info('Kensaku utilisé pour semantic_search', { version: located.version });
    }
    return { ok: true, hits: parsed.hits, total: parsed.total, version: located.version };
  }

  private skip(reason: KensakuSkip, detail: string): KensakuOutcome {
    this.inUse = false;
    const key = `${reason}:${detail}`;
    if (!this.reported.has(key)) {
      this.reported.add(key);
      const meta = { reason, detail };
      if (reason === 'absent') log.info('Kensaku absent : moteur par mots-clés', meta);
      else log.warn('Kensaku non utilisé : moteur par mots-clés', meta);
    }
    return { ok: false, reason, detail };
  }
}
