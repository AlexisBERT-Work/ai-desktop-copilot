import { execFile } from 'child_process';
import { promisify } from 'util';
import { access } from 'fs/promises';
import type { ToolResult } from '@catdesk/shared-types';
import { TOOL_SCHEMAS } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';

const exec = promisify(execFile);

interface RunSqliteArgs {
  db_path: string;
  query: string;
  read_only?: boolean;
}

// Only SELECT / PRAGMA(read) / EXPLAIN / WITH…SELECT are considered read-only.
export function isReadOnlyQuery(sql: string): boolean {
  // Strip comments and leading whitespace.
  const cleaned = sql
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trim();
  if (cleaned.length === 0) return false;

  // Reject multiple statements (defense against piggy-backed writes).
  const withoutTrailing = cleaned.replace(/;\s*$/, '');
  if (withoutTrailing.includes(';')) return false;

  const first = withoutTrailing.match(/^\s*(\w+)/)?.[1]?.toLowerCase() ?? '';
  if (first === 'select' || first === 'explain' || first === 'with') return true;
  if (first === 'pragma') {
    // A pragma that assigns a value (pragma x = y) can mutate; treat as write.
    return !/=/.test(withoutTrailing);
  }
  return false;
}

function sqliteMissing(msg: string): boolean {
  return /ENOENT|not recognized|introuvable|command not found|cannot find the file/i.test(msg);
}

export class RunSqliteTool extends BaseTool {
  readonly name = 'run_sqlite';
  readonly description =
    "Exécute du SQL sur une base SQLite locale via le CLI `sqlite3` (sortie JSON). En lecture seule par défaut (refuse tout sauf SELECT/PRAGMA/EXPLAIN/WITH). Mets read_only=false pour autoriser les écritures.";
  readonly category = 'system' as const;
  readonly riskLevel = 'medium' as const;
  readonly requiresConfirmation = false;
  readonly schema = TOOL_SCHEMAS.run_sqlite;

  async execute(args: unknown): Promise<ToolResult> {
    const { db_path, query, read_only = true } = args as RunSqliteArgs;

    if (typeof db_path !== 'string' || db_path.trim().length === 0) return this.fail('db_path est requis.');
    if (typeof query !== 'string' || query.trim().length === 0) return this.fail('query est requis.');

    if (read_only && !isReadOnlyQuery(query)) {
      return this.fail('Requête refusée en mode lecture seule. Seuls SELECT/PRAGMA/EXPLAIN/WITH (une seule instruction) sont permis. Mets read_only=false pour écrire.');
    }

    try {
      await access(db_path);
    } catch {
      return this.fail(`Base SQLite introuvable: ${db_path}`);
    }

    // -readonly enforces it at the SQLite layer too, not just our guard.
    const cliArgs = read_only ? ['-json', '-readonly', db_path, query] : ['-json', db_path, query];
    try {
      const { stdout } = await exec('sqlite3', cliArgs, {
        maxBuffer: 8_000_000,
        windowsHide: true,
      });
      const text = stdout.trim();
      let rows: unknown = text;
      if (text.length > 0) {
        try { rows = JSON.parse(text); } catch { /* keep raw text (e.g. write with no output) */ }
      } else {
        rows = [];
      }
      return this.ok({
        db: db_path,
        readOnly: read_only,
        ...(Array.isArray(rows) ? { rowCount: rows.length } : {}),
        rows,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (sqliteMissing(msg)) {
        return this.fail('CLI `sqlite3` introuvable. Installe-le (winget install SQLite.SQLite) ou ajoute-le au PATH.');
      }
      return this.fail(`Erreur SQLite: ${msg}`);
    }
  }
}
