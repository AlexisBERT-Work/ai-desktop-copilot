import { z } from 'zod';
import type { ToolResult } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { jsonSchemaFrom } from '../base/zodSchema';

export type Dialect = 'postgres' | 'mysql';

const argsSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe(
      'SQL to execute. Read-only by default: only single-statement SELECT/WITH/EXPLAIN/SHOW are allowed.',
    ),
  dialect: z
    .enum(['postgres', 'mysql'])
    .optional()
    .describe(
      'Database engine. Optional if the connection string scheme makes it clear (postgres:// / mysql://).',
    ),
  connection_string: z
    .string()
    .optional()
    .describe(
      'DSN, e.g. postgres://user:pass@host:5432/db or mysql://user:pass@host:3306/db. Falls back to PG_URL/MYSQL_URL/DATABASE_URL env vars.',
    ),
  read_only: z
    .boolean()
    .default(true)
    .describe('Reject writes (guard + DB-level READ ONLY transaction). Set false to allow writes.'),
  max_rows: z.number().default(1000).describe('Maximum number of rows to return'),
  timeout_ms: z
    .number()
    .max(60_000)
    .default(15_000)
    .describe('Query/connection timeout in milliseconds'),
});
type Args = z.infer<typeof argsSchema>;

/**
 * Only single-statement SELECT / WITH…SELECT / EXPLAIN / SHOW are read-only.
 * Mirrors RunSqliteTool's guard but tuned for Postgres/MySQL (adds SHOW).
 */
export function isReadOnlyDbQuery(sql: string): boolean {
  const cleaned = sql
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trim();
  if (cleaned.length === 0) return false;

  // Reject piggy-backed statements (defense against `SELECT 1; DROP TABLE …`).
  const withoutTrailing = cleaned.replace(/;\s*$/, '');
  if (withoutTrailing.includes(';')) return false;

  const first = withoutTrailing.match(/^\s*(\w+)/)?.[1]?.toLowerCase() ?? '';
  return first === 'select' || first === 'with' || first === 'explain' || first === 'show';
}

/** Resolve the dialect from an explicit value or a connection-string scheme. */
export function detectDialect(
  connectionString: string | undefined,
  explicit?: Dialect,
): Dialect | null {
  if (explicit === 'postgres' || explicit === 'mysql') return explicit;
  const scheme = connectionString?.match(/^([a-z0-9+]+):\/\//i)?.[1]?.toLowerCase();
  if (!scheme) return null;
  if (scheme === 'postgres' || scheme === 'postgresql') return 'postgres';
  if (scheme === 'mysql' || scheme === 'mariadb') return 'mysql';
  return null;
}

function envConnString(dialect: Dialect): string | undefined {
  if (dialect === 'postgres') {
    return process.env['PG_URL'] ?? process.env['POSTGRES_URL'] ?? process.env['DATABASE_URL'];
  }
  return process.env['MYSQL_URL'] ?? process.env['DATABASE_URL'];
}

interface QueryOutcome {
  rows: unknown[];
  fields: string[];
  affectedRows?: number;
}

export class QueryDatabaseTool extends BaseTool<Args> {
  readonly name = 'query_database';
  readonly description =
    "Exécute du SQL sur une base Postgres ou MySQL/MariaDB (driver natif Node). En lecture seule par défaut : garde anti-écriture (SELECT/WITH/EXPLAIN/SHOW, une seule instruction) + transaction READ ONLY au niveau du SGBD. Connexion via connection_string (postgres://… / mysql://…) ou variables d'env (DATABASE_URL / PG_URL / MYSQL_URL). Mets read_only=false pour autoriser les écritures.";
  readonly category = 'system' as const;
  readonly riskLevel = 'medium' as const;
  readonly requiresConfirmation = false;
  override readonly argsSchema = argsSchema;
  readonly schema = jsonSchemaFrom(argsSchema);

  async execute(args: Args): Promise<ToolResult> {
    const {
      query,
      dialect: explicitDialect,
      connection_string,
      read_only,
      max_rows,
      timeout_ms,
    } = args;

    const dialect = detectDialect(connection_string, explicitDialect);
    if (!dialect) {
      return this.fail(
        "Impossible de déterminer le SGBD. Fournis dialect ('postgres' ou 'mysql') ou une connection_string avec un schéma (postgres://… / mysql://…).",
      );
    }

    const connectionString = connection_string ?? envConnString(dialect);
    if (!connectionString) {
      return this.fail(
        `Aucune connexion. Fournis connection_string ou définis ${dialect === 'postgres' ? 'PG_URL/DATABASE_URL' : 'MYSQL_URL/DATABASE_URL'}.`,
      );
    }

    if (read_only && !isReadOnlyDbQuery(query)) {
      return this.fail(
        'Requête refusée en lecture seule. Seuls SELECT/WITH/EXPLAIN/SHOW (une seule instruction) sont permis. Mets read_only=false pour écrire.',
      );
    }

    const timeout = Math.min(Math.max(timeout_ms, 1_000), 60_000);

    try {
      const outcome =
        dialect === 'postgres'
          ? await this.runPostgres(connectionString, query, read_only, timeout)
          : await this.runMysql(connectionString, query, read_only, timeout);

      const truncated = outcome.rows.length > max_rows;
      return this.ok({
        dialect,
        readOnly: read_only,
        rowCount: outcome.rows.length,
        fields: outcome.fields,
        ...(outcome.affectedRows !== undefined ? { affectedRows: outcome.affectedRows } : {}),
        truncated,
        rows: truncated ? outcome.rows.slice(0, max_rows) : outcome.rows,
      });
    } catch (err) {
      return this.fail(this.explain(err, dialect));
    }
  }

  private async runPostgres(
    connectionString: string,
    query: string,
    readOnly: boolean,
    timeout: number,
  ): Promise<QueryOutcome> {
    const { Client } = await import('pg');
    const client = new Client({
      connectionString,
      statement_timeout: timeout,
      query_timeout: timeout,
      connectionTimeoutMillis: Math.min(timeout, 10_000),
    });
    await client.connect();
    try {
      if (readOnly) await client.query('BEGIN READ ONLY');
      const result = await client.query(query);
      if (readOnly) await client.query('ROLLBACK');
      const r = Array.isArray(result) ? result[result.length - 1]! : result;
      return {
        rows: r.rows ?? [],
        fields: (r.fields ?? []).map((f: { name: string }) => f.name),
        ...(typeof r.rowCount === 'number' && (r.rows?.length ?? 0) === 0
          ? { affectedRows: r.rowCount }
          : {}),
      };
    } finally {
      await client.end();
    }
  }

  private async runMysql(
    connectionString: string,
    query: string,
    readOnly: boolean,
    timeout: number,
  ): Promise<QueryOutcome> {
    const { createConnection } = await import('mysql2/promise');
    const conn = await createConnection(connectionString);
    try {
      if (readOnly) await conn.query('START TRANSACTION READ ONLY');
      const [rows, fields] = await conn.query({ sql: query, timeout });
      if (readOnly) await conn.query('ROLLBACK');
      if (Array.isArray(rows)) {
        return {
          rows: rows as unknown[],
          fields: Array.isArray(fields) ? fields.map((f: { name: string }) => f.name) : [],
        };
      }
      // ResultSetHeader (INSERT/UPDATE/DELETE) — no rows.
      const header = rows as { affectedRows?: number };
      return { rows: [], fields: [], affectedRows: header.affectedRows ?? 0 };
    } finally {
      await conn.end();
    }
  }

  private explain(err: unknown, dialect: Dialect): string {
    const msg = err instanceof Error ? err.message : String(err);
    if (/Cannot find module|ERR_MODULE_NOT_FOUND/i.test(msg)) {
      const pkg = dialect === 'postgres' ? 'pg' : 'mysql2';
      return `Driver ${pkg} introuvable. Installe-le : pnpm --filter @catdesk/agent-runtime add ${pkg}`;
    }
    if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|getaddrinfo/i.test(msg)) {
      return `Connexion au serveur ${dialect} impossible : ${msg}`;
    }
    if (/password authentication failed|Access denied|authentication/i.test(msg)) {
      return `Authentification ${dialect} refusée : ${msg}`;
    }
    if (/read[- ]only|cannot execute .* in a read-only transaction/i.test(msg)) {
      return `Écriture bloquée par la transaction lecture seule. Mets read_only=false pour modifier les données. (${msg})`;
    }
    return `Erreur ${dialect} : ${msg}`;
  }
}
