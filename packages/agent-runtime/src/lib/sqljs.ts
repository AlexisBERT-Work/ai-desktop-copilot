import type { SqlJsStatic } from 'sql.js';

let sqlJs: SqlJsStatic | null = null;

/**
 * Charge sql.js (module WASM) une seule fois, partagé par tous les stores
 * SQLite (conversations, mémoire chaude, playbook, historique bourse).
 */
export async function loadSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJs) {
    const sqljs = await import('sql.js');
    sqlJs = await sqljs.default({
      locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm'),
    });
  }
  return sqlJs;
}

export type { Database, ParamsObject } from 'sql.js';
