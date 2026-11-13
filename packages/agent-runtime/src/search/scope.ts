import { realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { expandPathEntry, isPathAllowed, pathEnv, type PathEnv } from '../permissions/pathPolicy';

/**
 * Où chercher quand on ne précise rien : les dossiers de la liste blanche, sauf
 * le dossier temporaire (il est autorisé pour que l'agent y écrive, pas parce
 * qu'on y range ses documents ; on peut toujours le nommer). Avant, c'était
 * `process.cwd()`, soit le dossier de l'agent lui-même, hors liste blanche.
 */
export function defaultSearchRoots(
  whitelist: readonly string[],
  env: PathEnv = pathEnv(),
  home: string = homedir(),
): string[] {
  if (whitelist.length === 0) return [home];
  const roots = whitelist
    .filter(entry => !/%te?mp%/i.test(entry))
    .map(entry => expandPathEntry(entry, env));
  return roots.length > 0 ? roots : whitelist.map(entry => expandPathEntry(entry, env));
}

export type ResolvePath = (path: string) => Promise<string>;

/** Rend le chemin réel si `path` est dans le périmètre, `null` sinon. */
export type ScopeCheck = (path: string) => Promise<string | null>;

async function withRealPaths(paths: readonly string[], resolve: ResolvePath): Promise<string[]> {
  const all = [...paths];
  for (const path of paths) {
    try {
      all.push(await resolve(path));
    } catch {
      // Racine absente : seul le chemin écrit compte.
    }
  }
  return all;
}

/**
 * Filtre des chemins renvoyés par un moteur de recherche. Chaque chemin est
 * RÉSOLU (jonctions, liens symboliques) puis doit tomber à la fois sous une
 * racine demandée et sous la liste blanche de CatDesk. Les deux, parce qu'une
 * racine demandée a été vérifiée lexicalement par le moteur de permissions :
 * si elle est elle-même une jonction vers `C:\Windows`, sa forme résolue y mène.
 *
 * Les racines comptent sous leur forme écrite ET résolue : un dossier Documents
 * redirigé ailleurs reste autorisé. Un chemin qui ne se résout pas (fichier
 * supprimé depuis l'indexation, accès refusé) est écarté.
 */
export async function createScopeCheck(
  roots: readonly string[],
  whitelist: readonly string[],
  resolve: ResolvePath = realpath,
  env: PathEnv = pathEnv(),
): Promise<ScopeCheck> {
  const expanded = (paths: readonly string[]): string[] => paths.map(p => expandPathEntry(p, env));
  const allowedRoots = await withRealPaths(expanded(roots), resolve);
  const allowedWhitelist =
    whitelist.length === 0 ? [] : await withRealPaths(expanded(whitelist), resolve);

  return async path => {
    if (allowedRoots.length === 0) return null;
    let real: string;
    try {
      real = await resolve(path);
    } catch {
      return null;
    }
    if (!isPathAllowed(real, allowedRoots, env)) return null;
    if (whitelist.length > 0 && !isPathAllowed(real, allowedWhitelist, env)) return null;
    return real;
  };
}

/**
 * Garde, dans l'ordre, les `limit` premiers éléments dans le périmètre. Ne
 * résout que ce qu'il faut : sur une liste triée par pertinence, on s'arrête
 * dès que `limit` sont gardés.
 */
export async function keepInScope<T>(
  items: readonly T[],
  pathOf: (item: T) => string,
  check: ScopeCheck,
  limit: number,
): Promise<{ kept: Array<{ item: T; realPath: string }>; dropped: number }> {
  const kept: Array<{ item: T; realPath: string }> = [];
  let dropped = 0;
  for (const item of items) {
    if (kept.length >= limit) break;
    const realPath = await check(pathOf(item));
    if (realPath === null) dropped++;
    else kept.push({ item, realPath });
  }
  return { kept, dropped };
}
