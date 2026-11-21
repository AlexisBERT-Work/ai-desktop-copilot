/**
 * Liste blanche des chemins : fonctions pures, partagées par le moteur de
 * permissions (les chemins qu'un outil DÉCLARE, avant exécution) et par
 * `semantic_search` (les chemins qu'un moteur externe RENVOIE, après).
 */

export interface PathEnv {
  userProfile: string;
  temp: string;
}

/** Valeurs de `%USERPROFILE%` et `%TEMP%`, lues à l'appel (les tests les changent). */
export function pathEnv(env: NodeJS.ProcessEnv = process.env): PathEnv {
  return {
    userProfile: env['USERPROFILE'] ?? 'C:/Users/user',
    temp: env['TEMP'] ?? env['TMP'] ?? 'C:/Temp',
  };
}

/** `%USERPROFILE%\Documents` → `C:\Users\Nom\Documents`. */
export function expandPathEntry(entry: string, env: PathEnv = pathEnv()): string {
  return entry.replace(/%userprofile%/gi, env.userProfile).replace(/%temp%/gi, env.temp);
}

// Même normalisation des deux côtés : minuscules + barres obliques. Elle DOIT
// venir APRÈS l'expansion des variables, pour que les valeurs expansées (qui
// gardent leur casse et leurs antislashs) soient normalisées elles aussi :
// sinon « %USERPROFILE%\Documents » devient « C:/Users/Name\Documents » et ne
// correspond jamais à un « /documents/… » en minuscules.
const norm = (p: string): string => p.replace(/\\/g, '/').toLowerCase();

/**
 * `path` est-il sous une entrée de la liste ? Une liste vide autorise tout.
 *
 * Contrôle LEXICAL : il ne suit ni jonction ni lien symbolique. Pour un chemin
 * venu d'un moteur externe, résoudre d'abord (`search/scope.ts`).
 */
export function isPathAllowed(
  path: string,
  whitelist: readonly string[],
  env: PathEnv = pathEnv(),
): boolean {
  if (whitelist.length === 0) return true;

  const normalized = norm(path);

  // Refus net de toute remontée : aucun chemin légitime de la liste blanche n'a
  // besoin d'un segment `..`. Sans ça, `…/Downloads/../.ssh/id_rsa` passe le
  // startsWith() ci-dessous (il commence par `…/Downloads`), et fs résout
  // ensuite le `..` pour lire hors des racines autorisées.
  if (normalized.split('/').some(seg => seg === '..')) return false;

  // Correspondance à une frontière de dossier : `…/documents` ne doit pas
  // autoriser son voisin `…/documents-evil`. Égalité exacte, ou racine suivie
  // d'un séparateur.
  return whitelist.some(entry => {
    const allowed = norm(expandPathEntry(entry, env));
    if (allowed.length === 0) return false;
    if (normalized === allowed) return true;
    const withSep = allowed.endsWith('/') ? allowed : `${allowed}/`;
    return normalized.startsWith(withSep);
  });
}
