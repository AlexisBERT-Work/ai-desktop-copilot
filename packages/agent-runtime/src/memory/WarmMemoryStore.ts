import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createLogger } from '../logger';

const log = createLogger('memory:warm');

/**
 * Warm memory layer (CATDESK-CONCEPTS-AVANCES §3): structured, instantly
 * queryable facts and preferences extracted from conversations — distinct from
 * the semantic vector store (raw documents) and the episodic message history.
 *
 * Each fact has a `subject` (a normalized key like "langage_prefere"); writing
 * a new value for an existing subject supersedes the old one rather than piling
 * up contradictions ("D works at X" → "D no longer works at X").
 */

export type WarmFactKind = 'preference' | 'fact';

export interface WarmFact {
  id: string;
  kind: WarmFactKind;
  /** Normalized key used for contradiction resolution (e.g. "editeur_prefere"). */
  subject: string;
  /** Human-readable statement (e.g. "préfère VS Code"). */
  value: string;
  confidence: number;
  source?: string;
  createdAt: number;
  updatedAt: number;
}

export interface WarmFactInput {
  kind: WarmFactKind;
  subject: string;
  value: string;
  confidence?: number;
  source?: string;
}

// sql.js (WASM) — loaded lazily, mirrors ConversationStore.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let SQL: any = null;
async function getSqlJs(): Promise<unknown> {
  if (!SQL) {
    const sqljs = await import('sql.js');
    SQL = await sqljs.default({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
  }
  return SQL;
}

export class WarmMemoryStore {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private db: any = null;
  private readonly dbPath: string;

  constructor(dataDir?: string) {
    const dir = dataDir ?? process.env['CATDESK_DATA_DIR'] ?? join(process.cwd(), 'data');
    mkdirSync(dir, { recursive: true });
    this.dbPath = join(dir, 'warm-memory.db');
  }

  async initialize(): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SqlJs = (await getSqlJs()) as any;
    this.db = existsSync(this.dbPath)
      ? new SqlJs.Database(readFileSync(this.dbPath))
      : new SqlJs.Database();
    this.db.run(`
      CREATE TABLE IF NOT EXISTS warm_facts (
        id         TEXT PRIMARY KEY,
        kind       TEXT NOT NULL,
        subject    TEXT NOT NULL,
        value      TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0.7,
        source     TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        active     INTEGER NOT NULL DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS idx_warm_active_subject ON warm_facts(active, subject);
    `);
    log.info('WarmMemoryStore initialized', { path: this.dbPath });
  }

  /**
   * Insert or update a fact, resolving contradictions by subject:
   * - same subject + same value → bump confidence/timestamp,
   * - same subject + new value  → supersede the old (active=0), insert the new,
   * - new subject               → insert.
   * Returns true when something durable changed (insert or supersede).
   */
  upsert(input: WarmFactInput, now = Date.now()): boolean {
    const subject = input.subject.trim().toLowerCase();
    const value = input.value.trim();
    if (!subject || !value) return false;

    const existing = this.getActiveBySubject(subject);
    if (existing) {
      if (existing.value.trim().toLowerCase() === value.toLowerCase()) {
        // Reaffirmation — keep one row, refresh it.
        this.db.run(`UPDATE warm_facts SET confidence=?, updated_at=? WHERE id=?`, [
          Math.max(existing.confidence, input.confidence ?? 0.7),
          now,
          existing.id,
        ]);
        this.persist();
        return false;
      }
      // Contradiction — retire the old value.
      this.db.run(`UPDATE warm_facts SET active=0, updated_at=? WHERE id=?`, [now, existing.id]);
    }

    this.db.run(
      `INSERT INTO warm_facts (id, kind, subject, value, confidence, source, created_at, updated_at, active)
       VALUES (?,?,?,?,?,?,?,?,1)`,
      [crypto.randomUUID(), input.kind, subject, value, input.confidence ?? 0.7, input.source ?? null, now, now],
    );
    this.persist();
    return true;
  }

  /** Active facts, most recently updated first. */
  getActiveFacts(limit = 50): WarmFact[] {
    const stmt = this.db.prepare(
      `SELECT * FROM warm_facts WHERE active=1 ORDER BY updated_at DESC LIMIT ?`,
    );
    stmt.bind([limit]);
    const rows: WarmFact[] = [];
    while (stmt.step()) rows.push(this.rowToFact(stmt.getAsObject()));
    stmt.free();
    return rows;
  }

  private getActiveBySubject(subject: string): WarmFact | null {
    const stmt = this.db.prepare(
      `SELECT * FROM warm_facts WHERE active=1 AND subject=? ORDER BY updated_at DESC LIMIT 1`,
    );
    stmt.bind([subject]);
    const fact = stmt.step() ? this.rowToFact(stmt.getAsObject()) : null;
    stmt.free();
    return fact;
  }

  /** Number of active facts — handy for tests and diagnostics. */
  count(): number {
    const stmt = this.db.prepare(`SELECT COUNT(*) AS n FROM warm_facts WHERE active=1`);
    stmt.step();
    const n = Number((stmt.getAsObject() as { n: number }).n);
    stmt.free();
    return n;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private rowToFact(row: any): WarmFact {
    return {
      id: row.id,
      kind: row.kind,
      subject: row.subject,
      value: row.value,
      confidence: Number(row.confidence),
      ...(row.source ? { source: row.source } : {}),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
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
