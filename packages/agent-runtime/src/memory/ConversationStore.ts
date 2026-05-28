import Database from 'better-sqlite3';
import { join } from 'path';
import { mkdirSync } from 'fs';
import type { OllamaMessage, ConversationSummary } from '@neurodesk/shared-types';
import { createLogger } from '../logger';

const log = createLogger('memory:sqlite');

export class ConversationStore {
  private db!: Database.Database;

  async initialize(): Promise<void> {
    const dataDir = process.env['NEURODESK_DATA_DIR'] ?? join(process.cwd(), 'data');
    mkdirSync(dataDir, { recursive: true });

    this.db = new Database(join(dataDir, 'conversations.db'));
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    this.migrate();
    log.info('ConversationStore initialized');
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT,
        model TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        tags TEXT DEFAULT '[]'
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tool_calls TEXT,
        tool_call_id TEXT,
        created_at INTEGER NOT NULL,
        metadata TEXT DEFAULT '{}'
      );

      CREATE INDEX IF NOT EXISTS idx_messages_conversation
        ON messages(conversation_id, created_at);

      -- Full-text search
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts
        USING fts5(content, conversation_id UNINDEXED);
    `);
  }

  createConversation(id: string, model: string, title?: string): void {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO conversations (id, title, model, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, title ?? null, model, now, now);
  }

  addMessage(conversationId: string, msg: {
    id: string;
    role: string;
    content: string;
    toolCalls?: unknown;
    toolCallId?: string;
    metadata?: unknown;
  }): void {
    const now = Date.now();

    this.db.prepare(`
      INSERT INTO messages (id, conversation_id, role, content, tool_calls, tool_call_id, created_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      msg.id, conversationId, msg.role, msg.content,
      msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
      msg.toolCallId ?? null,
      now,
      JSON.stringify(msg.metadata ?? {}),
    );

    // Update conversation updated_at
    this.db.prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`).run(now, conversationId);

    // Update FTS
    this.db.prepare(`INSERT INTO messages_fts (content, conversation_id) VALUES (?, ?)`).run(msg.content, conversationId);
  }

  getRecentMessages(conversationId: string, limit: number): OllamaMessage[] {
    const rows = this.db.prepare(`
      SELECT role, content, tool_calls, tool_call_id
      FROM messages
      WHERE conversation_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(conversationId, limit) as Array<{
      role: string;
      content: string;
      tool_calls: string | null;
      tool_call_id: string | null;
    }>;

    return rows.reverse().map(row => ({
      role: row.role as OllamaMessage['role'],
      content: row.content,
      ...(row.tool_calls ? { tool_calls: JSON.parse(row.tool_calls) } : {}),
      ...(row.tool_call_id ? { tool_call_id: row.tool_call_id } : {}),
    }));
  }

  listConversations(limit = 50): ConversationSummary[] {
    return this.db.prepare(`
      SELECT c.*,
        (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message,
        (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) as message_count
      FROM conversations c
      ORDER BY c.updated_at DESC
      LIMIT ?
    `).all(limit) as ConversationSummary[];
  }

  close(): void {
    this.db?.close();
  }
}
