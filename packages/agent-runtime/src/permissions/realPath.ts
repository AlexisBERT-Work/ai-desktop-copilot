import { lstat, realpath } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { expandPathEntry, isPathAllowed, pathEnv, type PathEnv } from './pathPolicy';

/**
 * Liste blanche appliquée au chemin RÉEL : jonctions et liens symboliques
 * suivis. `pathPolicy.ts` compare des chaînes ; ce module demande au disque où
 * elles mènent. Utilisé par le moteur de permissions (tout chemin déclaré par
 * un outil) et par `semantic_search` (`search/scope.ts`).
 */

export type ResolvePath = (path: string) => Promise<string>;

/** Ce que la résolution demande au disque. Injectable pour les tests. */
export interface PathProbe {
  realpath: ResolvePath;
  /** Rejette s'il n'y a rien à `path`. Ne suit pas un lien. */
  lstat: (path: string) => Promise<unknown>;
}

const NODE_PROBE: PathProbe = { realpath, lstat };

/**
 * Les chemins sous leur forme écrite ET résolue : un dossier Documents redirigé
 * ailleurs reste autorisé. Un chemin qui ne se résout pas (absent, illisible)
 * ne compte que sous sa forme écrite.
 */
export async function withRealPaths(
  paths: readonly string[],
  resolve: ResolvePath = realpath,
): Promise<string[]> {
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

export type ResolvedTarget = { ok: true; path: string } | { ok: false; reason: string };

function errorCode(err: unknown): string {
  if (err instanceof Error && 'code' in err && typeof err.code === 'string') return err.code;
  return 'erreur inconnue';
}

/** Un élément du chemin manque : on remonte d'un cran. */
const isAbsent = (err: unknown): boolean => ['ENOENT', 'ENOTDIR'].includes(errorCode(err));

/**
 * Où mène `path`. S'il existe : son chemin réel. Sinon (fichier à créer) : son
 * plus proche parent existant, résolu, suivi du reste du chemin tel qu'écrit.
 * Si rien n'existe, pas même la racine du disque, aucun lien n'est traversé :
 * le chemin écrit est la réponse.
 *
 * Refus (`ok: false`) quand la destination ne peut pas être connue : accès
 * refusé, boucle de liens, ou lien pendant (sa cible n'existe pas : écrire au
 * travers la créerait, ailleurs).
 */
export async function resolveTarget(
  path: string,
  probe: PathProbe = NODE_PROBE,
): Promise<ResolvedTarget> {
  const rest: string[] = [];
  let current = path;
  for (;;) {
    try {
      const real = await probe.realpath(current);
      return { ok: true, path: rest.length === 0 ? real : join(real, ...rest) };
    } catch (err) {
      if (!isAbsent(err)) return { ok: false, reason: `destination illisible : ${errorCode(err)}` };
    }

    // `realpath` dit « absent », mais l'entrée existe : un lien pendant.
    try {
      await probe.lstat(current);
      return { ok: false, reason: 'lien dont la cible est absente' };
    } catch (err) {
      if (!isAbsent(err)) return { ok: false, reason: `destination illisible : ${errorCode(err)}` };
    }

    const parent = dirname(current);
    // `parent === current` : racine du disque. `.` : chemin relatif pour l'OS
    // hôte (`C:/…` sous Linux, en CI), qu'on ne rattache pas au dossier courant.
    if (parent === current || parent === '.') return { ok: true, path };
    rest.unshift(basename(current));
    current = parent;
  }
}

export type PathVerdict = { allowed: true } | { allowed: false; reason: string };

/**
 * Contrôle des chemins qu'un outil déclare, avant son exécution :
 *
 * 1. le chemin ÉCRIT doit être sous une racine, écrite ou résolue
 *    (`isPathAllowed` : frontière de dossier, tout segment `..` refusé). Un
 *    chemin qui n'a rien à voir avec la liste n'est jamais présenté au disque :
 *    `realpath` sur `\\hôte\partage` ouvrirait une connexion SMB vers cet hôte ;
 * 2. son chemin RÉEL (`resolveTarget`) doit l'être encore : une jonction posée
 *    dans Documents vers `C:\Windows` est refusée, en lecture comme en écriture.
 *
 * Liste vide : tout passe, sans accès au disque. Les racines sont résolues une
 * seule fois par garde, au premier chemin vérifié.
 *
 * Reste une fenêtre entre la vérification et l'ouverture du fichier par l'outil :
 * une jonction créée entre les deux n'est pas vue.
 */
export function createPathGuard(
  whitelist: readonly string[],
  env: PathEnv = pathEnv(),
  probe: PathProbe = NODE_PROBE,
): (path: string) => Promise<PathVerdict> {
  let roots: Promise<string[]> | undefined;

  return async path => {
    if (whitelist.length === 0) return { allowed: true };
    const denied = (detail?: string): PathVerdict => ({
      allowed: false,
      reason: `Chemin non autorisé: ${path}${detail === undefined ? '' : ` (${detail})`}`,
    });

    roots ??= withRealPaths(
      whitelist.map(entry => expandPathEntry(entry, env)),
      probe.realpath,
    );
    const allowedRoots = await roots;
    if (!isPathAllowed(path, allowedRoots, env)) return denied();

    const target = await resolveTarget(path, probe);
    if (!target.ok) return denied(target.reason);
    if (!isPathAllowed(target.path, allowedRoots, env)) return denied(`mène à ${target.path}`);
    return { allowed: true };
  };
}
