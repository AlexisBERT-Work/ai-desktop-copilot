import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { OllamaMessage, ConversationSummary } from '@neurodesk/shared-types';
import { createLogger } from '../logger';

export interface ScheduledJob {
  id: string;
  name: string;
  task: string;
  schedule: string;
  enabled: boolean;
  createdAt: number;
  lastRunAt?: number;
  nextRunAt: number;
  lastResult?: string;
  lastError?: string;
  runCount: number;
}

const log = createLogger('memory:sqlite');

// sql.js is loaded lazily (WASM module)
let SQL: any = null;

async function getSqlJs() {
  if (!SQL) {
    const sqljs = await import('sql.js');
    SQL = await sqljs.default({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
  }
  return SQL;
}

export class ConversationStore {
  private db: any = null;
  private dbPath: string;

  constructor() {
    const dataDir = process.env['NEURODESK_DATA_DIR'] ?? join(process.cwd(), 'data');
    mkdirSync(dataDir, { recursive: true });
    this.dbPath = join(dataDir, 'conversations.db');
  }

  async initialize(): Promise<void> {
    const SqlJs = await getSqlJs();

    // Load existing DB from file, or create new
    if (existsSync(this.dbPath)) {
      const buffer = readFileSync(this.dbPath);
      this.db = new SqlJs.Database(buffer);
    } else {
      this.db = new SqlJs.Database();
    }

    this.migrate();
    log.info('ConversationStore initialized', { path: this.dbPath });
  }

  private migrate(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT,
        model TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tool_calls TEXT,
        tool_call_id TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_messages_conversation
        ON messages(conversation_id, created_at);

      CREATE TABLE IF NOT EXISTS scheduled_tasks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        task TEXT NOT NULL,
        schedule TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        last_run_at INTEGER,
        next_run_at INTEGER NOT NULL,
        last_result TEXT,
        last_error TEXT,
        run_count INTEGER NOT NULL DEFAULT 0
      );
    `);
    this.persist();
  }

  createConversation(id: string, model: string, title?: string): void {
    const now = Date.now();
    this.db.run(
      `INSERT OR IGNORE INTO conversations (id, title, model, created_at, updated_at) VALUES (?,?,?,?,?)`,
      [id, title ?? null, model, now, now],
    );
    this.persist();
  }

  addMessage(conversationId: string, msg: {
    id: string;
    role: string;
    content: string;
    toolCalls?: unknown;
    toolCallId?: string;
  }): void {
    const now = Date.now();
    this.db.run(
      `INSERT INTO messages (id, conversation_id, role, content, tool_calls, tool_call_id, created_at)
       VALUES (?,?,?,?,?,?,?)`,
      [
        msg.id, conversationId, msg.role, msg.content,
        msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
        msg.toolCallId ?? null,
        now,
      ],
    );
    this.db.run(`UPDATE conversations SET updated_at=? WHERE id=?`, [now, conversationId]);
    this.persist();
  }

  getRecentMessages(conversationId: string, limit: number): OllamaMessage[] {
    const stmt = this.db.prepare(
      `SELECT role, content, tool_calls, tool_call_id FROM messages
       WHERE conversation_id=? ORDER BY created_at DESC LIMIT ?`,
    );
    stmt.bind([conversationId, limit]);

    const rows: Array<{ role: string; content: string; tool_calls: string | null; tool_call_id: string | null }> = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as any;
      rows.push(row);
    }
    stmt.free();

    return rows.reverse().map(row => ({
      role: row.role as OllamaMessage['role'],
      content: row.content,
      ...(row.tool_calls ? { tool_calls: JSON.parse(row.tool_calls) } : {}),
      ...(row.tool_call_id ? { tool_call_id: row.tool_call_id } : {}),
    }));
  }

  listConversations(limit = 50): ConversationSummary[] {
    const stmt = this.db.prepare(
      `SELECT c.id, c.title, c.model, c.created_at as createdAt, c.updated_at as updatedAt,
              (SELECT COUNT(*) FROM messages WHERE conversation_id=c.id) as messageCount
       FROM conversations c ORDER BY c.updated_at DESC LIMIT ?`,
    );
    stmt.bind([limit]);
    const rows: ConversationSummary[] = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as any);
    }
    stmt.free();
    return rows;
  }

  // ─── Scheduled Tasks ───────────────────────────────────────────

  saveScheduledTask(job: ScheduledJob): void {
    this.db.run(
      `INSERT OR REPLACE INTO scheduled_tasks
       (id, name, task, schedule, enabled, created_at, last_run_at, next_run_at, last_result, last_error, run_count)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        job.id, job.name, job.task, job.schedule,
        job.enabled ? 1 : 0,
        job.createdAt,
        job.lastRunAt ?? null,
        job.nextRunAt,
        job.lastResult ?? null,
        job.lastError ?? null,
        job.runCount,
      ],
    );
    this.persist();
  }

  getScheduledTasks(): ScheduledJob[] {
    const stmt = this.db.prepare(
      `SELECT id, name, task, schedule, enabled, created_at, last_run_at, next_run_at, last_result, last_error, run_count
       FROM scheduled_tasks ORDER BY created_at ASC`,
    );
    const rows: ScheduledJob[] = [];
    while (stmt.step()) {
      const r = stmt.getAsObject() as any;
      rows.push({
        id: r.id as string,
        name: r.name as string,
        task: r.task as string,
        schedule: r.schedule as string,
        enabled: (r.enabled as number) === 1,
        createdAt: r.created_at as number,
        ...(r.last_run_at !== null ? { lastRunAt: r.last_run_at as number } : {}),
        nextRunAt: r.next_run_at as number,
        ...(r.last_result !== null ? { lastResult: r.last_result as string } : {}),
        ...(r.last_error !== null ? { lastError: r.last_error as string } : {}),
        runCount: r.run_count as number,
      });
    }
    stmt.free();
    return rows;
  }

  deleteScheduledTask(id: string): void {
    this.db.run(`DELETE FROM scheduled_tasks WHERE id=?`, [id]);
    this.persist();
  }

  updateScheduledTaskRun(id: string, opts: { lastRunAt: number; nextRunAt: number; lastResult?: string; lastError?: string }): void {
    this.db.run(
      `UPDATE scheduled_tasks
       SET last_run_at=?, next_run_at=?, last_result=?, last_error=?, run_count=run_count+1
       WHERE id=?`,
      [opts.lastRunAt, opts.nextRunAt, opts.lastResult ?? null, opts.lastError ?? null, id],
    );
    this.persist();
  }

  /** Write DB to disk (sql.js is in-memory, must be serialized) */
  private persist(): void {
    try {
      const data = this.db.export();
      writeFileSync(this.dbPath, Buffer.from(data));
    } catch {
      // Non-fatal
    }
  }

  close(): void {
    this.persist();
    this.db?.close();
  }
}
