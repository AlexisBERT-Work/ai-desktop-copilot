import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ConversationStore } from './ConversationStore';

describe('ConversationStore summary + getMessagesSince', () => {
  let dir: string;
  let prev: string | undefined;
  let db: ConversationStore;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ndcs-test-'));
    prev = process.env['CATDESK_DATA_DIR'];
    process.env['CATDESK_DATA_DIR'] = dir;
    db = new ConversationStore();
    await db.initialize();
  });

  afterEach(() => {
    db.close();
    if (prev === undefined) delete process.env['CATDESK_DATA_DIR']; else process.env['CATDESK_DATA_DIR'] = prev;
    rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips a conversation summary', () => {
    expect(db.getSummary('c')).toBeNull();
    db.setSummary('c', 'un résumé', 4242);
    expect(db.getSummary('c')).toEqual({ summary: 'un résumé', throughTs: 4242 });
    // upsert replaces
    db.setSummary('c', 'maj', 9000);
    expect(db.getSummary('c')).toEqual({ summary: 'maj', throughTs: 9000 });
  });

  it('getMessagesSince filters by timestamp and conversation', () => {
    db.createConversation('c', 'm');
    db.addMessage('c', { id: 'a', role: 'user', content: 'q1' });
    db.addMessage('c', { id: 'b', role: 'assistant', content: 'r1' });
    db.createConversation('other', 'm');
    db.addMessage('other', { id: 'z', role: 'user', content: 'autre' });

    const all = db.getMessagesSince('c', 0);
    expect(all.map(m => m.content)).toEqual(['q1', 'r1']);
    expect(all.every(m => typeof m.createdAt === 'number')).toBe(true);

    // Nothing after a far-future timestamp.
    expect(db.getMessagesSince('c', Date.now() + 100000)).toHaveLength(0);
  });
});
