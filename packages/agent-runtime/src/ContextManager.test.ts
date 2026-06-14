import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ContextManager } from './ContextManager';
import { ConversationStore } from './memory/ConversationStore';
import { VectorStore } from './memory/VectorStore';

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

describe('ContextManager semantic recall (rememberExchange)', () => {
  let dir: string;
  let prevDataDir: string | undefined;
  let db: ConversationStore;
  let vectors: VectorStore;
  let ctx: ContextManager;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ndctx2-test-'));
    prevDataDir = process.env['CATDESK_DATA_DIR'];
    process.env['CATDESK_DATA_DIR'] = dir;
    db = new ConversationStore();
    await db.initialize();
    vectors = new VectorStore(undefined, dir); // no embedder → BM25 path
    await vectors.initialize();
    ctx = new ContextManager(db, vectors);
  });

  afterEach(() => {
    db.close();
    if (prevDataDir === undefined) delete process.env['CATDESK_DATA_DIR'];
    else process.env['CATDESK_DATA_DIR'] = prevDataDir;
    rmSync(dir, { recursive: true, force: true });
  });

  it('indexes an exchange so a later, different conversation can recall it', async () => {
    await ctx.rememberExchange('conv-A', 'Quel est le port du serveur Postgres ?', 'Le port Postgres est 5544.');
    // A new conversation with no history asks about the same topic.
    const c = await ctx.buildContext('conv-B', 'rappelle-moi le port postgres');
    expect(c.messages).toHaveLength(0); // no shared conversation history
    expect((c.relevantMemories ?? []).join('\n')).toContain('5544');
  });

  it('does not index trivially short exchanges', async () => {
    await ctx.rememberExchange('c', 'ok', 'ok');
    const c = await ctx.buildContext('c2', 'ok');
    expect(c.relevantMemories ?? []).toHaveLength(0);
  });
});
