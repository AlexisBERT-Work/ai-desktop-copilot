import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createLogger } from '../logger';
import { loadSqlJs, type Database, type ParamsObject } from '../lib/sqljs';

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

export class WarmMemoryStore {
  // Affectée dans initialize() — tout accès avant est un bug d'ordre de démarrage.
  private db!: Database;
  private readonly dbPath: string;

  constructor(dataDir?: string) {
    const dir = dataDir ?? process.env['CATDESK_DATA_DIR'] ?? join(process.cwd(), 'data');
    mkdirSync(dir, { recursive: true });
    this.dbPath = join(dir, 'warm-memory.db');
  }

  async initialize(): Promise<void> {
    const SqlJs = await loadSqlJs();
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
      [
        crypto.randomUUID(),
        input.kind,
        subject,
        value,
        input.confidence ?? 0.7,
        input.source ?? null,
        now,
        now,
      ],
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

  /**
   * Retire the lower-quality duplicates when several active facts carry the
   * same value under different subjects (e.g. "editeur" and "editeur_prefere"
   * both = "préfère VS Code"). Keeps the strongest of each group (highest
   * confidence, then most recent). Returns how many rows were retired.
   */
  dedupeByValue(now = Date.now()): number {
    const groups = new Map<string, WarmFact[]>();
    for (const f of this.getActiveFacts(1000)) {
      const key = f.value.trim().toLowerCase().replace(/\s+/g, ' ');
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(f);
    }

    let retired = 0;
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      // Best first: higher confidence, then newer.
      group.sort((a, b) => b.confidence - a.confidence || b.updatedAt - a.updatedAt);
      for (const f of group.slice(1)) {
        this.db.run(`UPDATE warm_facts SET active=0, updated_at=? WHERE id=?`, [now, f.id]);
        retired++;
      }
    }
    if (retired > 0) this.persist();
    return retired;
  }

  /**
   * Retire stale, low-confidence facts: active rows not refreshed for
   * `maxAgeMs` whose confidence is below `minConfidence`. High-confidence facts
   * never expire on age alone. Returns how many rows were retired.
   */
  prune(opts: { maxAgeMs: number; minConfidence: number }, now = Date.now()): number {
    const cutoff = now - opts.maxAgeMs;
    let retired = 0;
    for (const f of this.getActiveFacts(1000)) {
      if (f.updatedAt < cutoff && f.confidence < opts.minConfidence) {
        this.db.run(`UPDATE warm_facts SET active=0, updated_at=? WHERE id=?`, [now, f.id]);
        retired++;
      }
    }
    if (retired > 0) this.persist();
    return retired;
  }

  private rowToFact(row: ParamsObject): WarmFact {
    return {
      id: row.id as string,
      kind: row.kind as WarmFact['kind'],
      subject: row.subject as string,
      value: row.value as string,
      confidence: Number(row.confidence),
      ...(row.source ? { source: row.source as string } : {}),
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
