import { mkdirSync } from 'fs';
import { join } from 'path';
import { CONFIG } from '../config';

/**
 * Résout un chemin sous le répertoire de données et garantit qu'il existe.
 *
 * Huit stores recopiaient la même expression
 * `dataDir ?? process.env['CATDESK_DATA_DIR'] ?? join(process.cwd(), 'data')`
 * suivie d'un `mkdirSync` — en court-circuitant `CONFIG.dataDir`, qui calcule
 * déjà exactement ça. Une seule définition, donc un seul endroit à changer.
 *
 * `CATDESK_DATA_DIR` est relu À CHAQUE APPEL, et non pris dans `CONFIG` (figé à
 * l'import) : les stores sont construits bien après le démarrage, et les tests
 * réaffectent la variable entre deux cas pour isoler leur répertoire temporaire.
 * `CONFIG.dataDir` reste le repli — c'est lui qui porte la valeur par défaut.
 *
 * @param fileName  nom du fichier de données (ex. `conversations.db`)
 * @param override  répertoire imposé par l'appelant, prioritaire sur tout
 * @param subDir    sous-dossier optionnel (ex. `audit`)
 */
export function dataPath(fileName: string, override?: string, subDir?: string): string {
  const base = override ?? process.env['CATDESK_DATA_DIR'] ?? CONFIG.dataDir;
  const dir = subDir === undefined ? base : join(base, subDir);
  mkdirSync(dir, { recursive: true });
  return join(dir, fileName);
}
