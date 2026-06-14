import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ContextManager } from './ContextManager';
import { ConversationStore } from './memory/ConversationStore';

// Vector search is irrelevant here — stub it so we test conversation memory only.
const fakeVectorStore = { search: async () => [] } as never;

describe('ContextManager conversation memory', () => {
  let dir: string;
  let prevDataDir: string | undefined;
  let db: ConversationStore;
  let ctx: ContextManager;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ndctx-test-'));
    prevDataDir = process.env['CATDESK_DATA_DIR'];
    process.env['CATDESK_DATA_DIR'] = dir;
    db = new ConversationStore();
    await db.initialize();
    ctx = new ContextManager(db, fakeVectorStore);
  });

  afterEach(() => {
    db.close();
    if (prevDataDir === undefined) delete process.env['CATDESK_DATA_DIR'];
    else process.env['CATDESK_DATA_DIR'] = prevDataDir;
    rmSync(dir, { recursive: true, force: true });
  });

  it('starts with no history', async () => {
    const c = await ctx.buildContext('conv', 'salut');
    expect(c.messages).toHaveLength(0);
  });

  it('recordTurn persists a turn that the next buildContext sees', async () => {
    ctx.recordTurn('conv', 'qwen2.5:7b', 'je préfère pnpm', "d'accord, noté");
    const c = await ctx.buildContext('conv', 'et pour le reste ?');
    expect(c.messages.map(m => m.content)).toEqual(['je préfère pnpm', "d'accord, noté"]);
    expect(c.messages.map(m => m.role)).toEqual(['user', 'assistant']);
  });

  it('accumulates across turns and stays scoped to the conversation', async () => {
    ctx.recordTurn('A', 'm', 'q1', 'r1');
    ctx.recordTurn('A', 'm', 'q2', 'r2');
    ctx.recordTurn('B', 'm', 'autre', 'rep');

    const a = await ctx.buildContext('A', 'x');
    expect(a.messages.map(m => m.content)).toEqual(['q1', 'r1', 'q2', 'r2']);
    const b = await ctx.buildContext('B', 'x');
    expect(b.messages.map(m => m.content)).toEqual(['autre', 'rep']);
  });

  it('skips empty user/assistant text', async () => {
    ctx.recordTurn('conv', 'm', '   ', 'réponse seule');
    const c = await ctx.buildContext('conv', 'x');
    expect(c.messages.map(m => m.content)).toEqual(['réponse seule']);
  });
});
