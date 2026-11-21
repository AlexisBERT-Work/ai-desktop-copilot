// Persistance locale partagée par les stores du runtime.
//
// Neuf stores (quatre SQLite via sql.js, cinq JSON) recopiaient chacun leur
// « lire le fichier s'il existe / tout réécrire à chaque modification » — et
// écrivaient en place : un arrêt brutal pendant l'écriture laissait un fichier
// tronqué, et une base SQLite illisible faisait échouer le démarrage de tout
// l'agent. Ce module centralise les deux gestes et les rend sûrs.

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Logger } from '../logger';
import { loadSqlJs, type Database } from './sqljs';

/**
 * Écrit via un fichier temporaire puis `rename` : le fichier cible est
 * toujours soit l'ancienne version complète, soit la nouvelle — jamais un
 * entre-deux. Si Windows refuse le remplacement (fichier verrouillé par un
 * antivirus ou un indexeur), on retombe sur une écriture directe plutôt que de
 * perdre la donnée.
 */
export function writeFileAtomic(path: string, data: string | Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, data);
  try {
    renameSync(tmp, path);
  } catch {
    writeFileSync(path, data);
    rmSync(tmp, { force: true });
  }
}

/**
 * Lit et parse un fichier JSON. `undefined` si le fichier est absent ; un
 * fichier illisible est signalé puis traité comme absent — un store de
 * confort ne doit jamais empêcher l'agent de démarrer.
 */
export function readJsonFile(path: string, log: Logger): unknown {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch (err) {
    log.warn('Fichier JSON illisible — on repart à vide', { path, error: String(err) });
    return undefined;
  }
}

/** Sérialise en JSON et écrit atomiquement. Erreur journalisée, jamais propagée. */
export function writeJsonFile(path: string, value: unknown, log: Logger, pretty = false): void {
  try {
    writeFileAtomic(path, JSON.stringify(value, null, pretty ? 2 : undefined));
  } catch (err) {
    log.warn('Écriture JSON impossible', { path, error: String(err) });
  }
}

/**
 * Base SQLite en mémoire (sql.js) adossée à un fichier. sql.js ne persiste
 * rien tout seul : chaque store appelle `persist()` après ses écritures.
 */
export class SqliteFile {
  private constructor(
    readonly db: Database,
    private readonly path: string,
    private readonly log: Logger,
  ) {}

  /**
   * Ouvre (ou crée) la base et applique `schema` (DDL idempotent). Une base
   * corrompue est mise de côté (`<nom>.corrupt-<horodatage>`) et remplacée par
   * une base vide, au lieu de faire échouer le démarrage de l'agent.
   */
  static async open(path: string, schema: string, log: Logger): Promise<SqliteFile> {
    const SqlJs = await loadSqlJs();
    let db: Database;
    try {
      db = existsSync(path) ? new SqlJs.Database(readFileSync(path)) : new SqlJs.Database();
      db.run(schema);
    } catch (err) {
      const aside = `${path}.corrupt-${Date.now()}`;
      log.error('Base SQLite illisible — mise de côté, base neuve créée', {
        path,
        aside,
        error: String(err),
      });
      try {
        renameSync(path, aside);
      } catch {
        /* rien à déplacer, ou fichier verrouillé : la base neuve l'écrasera */
      }
      db = new SqlJs.Database();
      db.run(schema);
    }
    const file = new SqliteFile(db, path, log);
    file.persist();
    return file;
  }

  /** Écrit la base sur disque (atomique). Erreur journalisée, jamais propagée. */
  persist(): void {
    try {
      writeFileAtomic(this.path, this.db.export());
    } catch (err) {
      this.log.warn('Persistance SQLite impossible', { path: this.path, error: String(err) });
    }
  }

  close(): void {
    this.persist();
    this.db.close();
  }
}
