import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createLogger } from '../logger';

const log = createLogger('playbook:store');

/**
 * Strategy playbook (CATDESK-CONCEPTS-AVANCES §8): per task type, which
 * approach (the sequence of tools used) succeeded, with running success/failure
 * counts. Consulted before a task to nudge the agent toward what worked, and
 * updated after each run from its outcome. This is the actionable, queryable
 * trace store — distinct from the append-only audit log.
 */

export interface BestApproach {
  approach: string;
  successRate: number;
  attempts: number;
}

/** One row of the strategy table — the raw trace the evolution daemon reads. */
export interface StrategyRow {
  taskType: string;
  approach: string;
  successes: number;
  failures: number;
  updatedAt: number;
}

// sql.js (WASM), loaded lazily — mirrors the other stores.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let SQL: any = null;
async function getSqlJs(): Promise<unknown> {
  if (!SQL) {
    const sqljs = await import('sql.js');
    SQL = await sqljs.default({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
  }
  return SQL;
}

export class PlaybookStore {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private db: any = null;
  private readonly dbPath: string;

  constructor(dataDir?: string) {
    const dir = dataDir ?? process.env['CATDESK_DATA_DIR'] ?? join(process.cwd(), 'data');
    mkdirSync(dir, { recursive: true });
    this.dbPath = join(dir, 'playbook.db');
  }

  async initialize(): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SqlJs = (await getSqlJs()) as any;
    this.db = existsSync(this.dbPath)
      ? new SqlJs.Database(readFileSync(this.dbPath))
      : new SqlJs.Database();
    this.db.run(`
      CREATE TABLE IF NOT EXISTS strategies (
        task_type  TEXT NOT NULL,
        approach   TEXT NOT NULL,
        successes  INTEGER NOT NULL DEFAULT 0,
        failures   INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (task_type, approach)
      );
    `);
    log.info('PlaybookStore initialized', { path: this.dbPath });
  }

  /** Record the outcome of one run for a (task type, approach). */
  record(taskType: string, approach: string, success: boolean, now = Date.now()): void {
    const s = success ? 1 : 0;
    const f = success ? 0 : 1;
    this.db.run(
      `INSERT INTO strategies (task_type, approach, successes, failures, updated_at)
       VALUES (?,?,?,?,?)
       ON CONFLICT(task_type, approach) DO UPDATE SET
         successes = successes + ?, failures = failures + ?, updated_at = ?`,
      [taskType, approach, s, f, now, s, f, now],
    );
    this.persist();
  }

  /**
   * Best approach worth suggesting for a task type: enough attempts, and more
   * successes than failures. Returns null when there's nothing trustworthy yet.
   */
  bestApproach(taskType: string, minAttempts = 2): BestApproach | null {
    const stmt = this.db.prepare(
      `SELECT approach, successes, failures FROM strategies
       WHERE task_type=? AND (successes + failures) >= ? AND successes > failures
       ORDER BY (CAST(successes AS REAL) / (successes + failures)) DESC, successes DESC
       LIMIT 1`,
    );
    stmt.bind([taskType, minAttempts]);
    let result: BestApproach | null = null;
    if (stmt.step()) {
      const r = stmt.getAsObject() as { approach: string; successes: number; failures: number };
      const attempts = r.successes + r.failures;
      result = { approach: r.approach, successRate: r.successes / attempts, attempts };
    }
    stmt.free();
    return result;
  }

  /** All recorded strategies — the trace set the evolution daemon analyzes. */
  allStrategies(): StrategyRow[] {
    const stmt = this.db.prepare(
      `SELECT task_type, approach, successes, failures, updated_at FROM strategies`,
    );
    const rows: StrategyRow[] = [];
    while (stmt.step()) {
      const r = stmt.getAsObject() as {
        task_type: string; approach: string; successes: number; failures: number; updated_at: number;
      };
      rows.push({
        taskType: r.task_type,
        approach: r.approach,
        successes: r.successes,
        failures: r.failures,
        updatedAt: r.updated_at,
      });
    }
    stmt.free();
    return rows;
  }

  private persist(): void {
    try {
      writeFileSync(this.dbPath, Buffer.from(this.db.export()));
    } catch (err) {
      log.warn('Persist failed', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  close(): void {
    this.db?.close();
  }
}

/** Stable signature of the tools a run used, in first-use order (deduped). */
export function approachSignature(tools: string[]): string {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const t of tools) {
    if (!seen.has(t)) { seen.add(t); ordered.push(t); }
  }
  return ordered.length > 0 ? ordered.join('>') : '(réponse directe)';
}
