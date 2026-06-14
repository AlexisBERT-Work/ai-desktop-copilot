import { describe, it, expect, vi } from 'vitest';
import { Compactor } from './Compactor';
import type { ConversationStore } from './ConversationStore';

/** In-memory fake of the ConversationStore slice the Compactor uses. */
function fakeStore() {
  const msgs = new Map<string, Array<{ role: string; content: string; createdAt: number }>>();
  const summaries = new Map<string, { summary: string; throughTs: number }>();
  return {
    seed(convId: string, n: number) {
      const arr = Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}`, createdAt: 1000 + i }));
      msgs.set(convId, arr);
    },
    getSummary: (id: string) => summaries.get(id) ?? null,
    setSummary: (id: string, summary: string, throughTs: number) => { summaries.set(id, { summary, throughTs }); },
    getMessagesSince: (id: string, sinceTs: number) => (msgs.get(id) ?? []).filter(m => m.createdAt > sinceTs),
  };
}

describe('Compactor', () => {
  it('does nothing below the threshold', async () => {
    const store = fakeStore();
    store.seed('c', 10);
    const summarizer = { summarize: vi.fn() };
    const c = new Compactor(store as unknown as ConversationStore, summarizer as never, { threshold: 16, keepRecent: 6 });
    const r = await c.maybeCompact('c');
    expect(r.compacted).toBe(false);
    expect(summarizer.summarize).not.toHaveBeenCalled();
  });

  it('folds all but keepRecent once over threshold and advances the marker', async () => {
    const store = fakeStore();
    store.seed('c', 20); // createdAt 1000..1019
    const summarizer = { summarize: vi.fn(async () => 'RÉSUMÉ') };
    const c = new Compactor(store as unknown as ConversationStore, summarizer as never, { threshold: 16, keepRecent: 6 });

    const r = await c.maybeCompact('c');
    expect(r).toEqual({ compacted: true, folded: 14 }); // 20 - 6
    expect(summarizer.summarize).toHaveBeenCalledOnce();

    const saved = store.getSummary('c');
    expect(saved?.summary).toBe('RÉSUMÉ');
    expect(saved?.throughTs).toBe(1013); // createdAt of the 14th message (index 13)

    // After the marker only the 6 recent messages remain visible.
    expect(store.getMessagesSince('c', saved!.throughTs)).toHaveLength(6);
  });

  it('passes the prior summary so it accumulates', async () => {
    const store = fakeStore();
    store.seed('c', 20);
    store.setSummary('c', 'ANCIEN', 0);
    const summarizer = { summarize: vi.fn(async () => 'NOUVEAU') };
    const c = new Compactor(store as unknown as ConversationStore, summarizer as never, { threshold: 16, keepRecent: 6 });

    await c.maybeCompact('c');
    expect(summarizer.summarize).toHaveBeenCalledWith(expect.any(Array), 'ANCIEN');
  });

  it('does not save when the summarizer returns empty', async () => {
    const store = fakeStore();
    store.seed('c', 20);
    const summarizer = { summarize: vi.fn(async () => '   ') };
    const c = new Compactor(store as unknown as ConversationStore, summarizer as never, { threshold: 16, keepRecent: 6 });
    const r = await c.maybeCompact('c');
    expect(r.compacted).toBe(false);
    expect(store.getSummary('c')).toBeNull();
  });
});
