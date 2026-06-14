import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { WarmMemoryStore } from './WarmMemoryStore';
import { MemoryConsolidator } from './MemoryConsolidator';

const DAY = 24 * 60 * 60 * 1000;

describe('WarmMemoryStore maintenance', () => {
  let dir: string;
  let store: WarmMemoryStore;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ndcons-test-'));
    store = new WarmMemoryStore(dir);
    await store.initialize();
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('dedupeByValue merges same-value facts under different subjects', () => {
    store.upsert({ kind: 'preference', subject: 'editeur', value: 'préfère VS Code', confidence: 0.6 });
    store.upsert({ kind: 'preference', subject: 'editeur_prefere', value: 'Préfère VS Code', confidence: 0.9 });
    expect(store.count()).toBe(2);

    const retired = store.dedupeByValue();
    expect(retired).toBe(1);
    expect(store.count()).toBe(1);
    // The higher-confidence row survives.
    expect(store.getActiveFacts()[0]?.confidence).toBe(0.9);
  });

  it('dedupeByValue leaves distinct values untouched', () => {
    store.upsert({ kind: 'fact', subject: 'a', value: 'Rust' });
    store.upsert({ kind: 'fact', subject: 'b', value: 'React' });
    expect(store.dedupeByValue()).toBe(0);
    expect(store.count()).toBe(2);
  });

  it('prune retires stale low-confidence facts only', () => {
    const now = Date.now();
    // Fresh low-confidence — kept (not stale).
    store.upsert({ kind: 'fact', subject: 'fresh', value: 'x', confidence: 0.2 }, now);
    // Old but high-confidence — kept (confidence floor).
    store.upsert({ kind: 'fact', subject: 'strong', value: 'y', confidence: 0.9 }, now - 40 * DAY);
    // Old and low-confidence — pruned.
    store.upsert({ kind: 'fact', subject: 'weak', value: 'z', confidence: 0.3 }, now - 40 * DAY);

    const pruned = store.prune({ maxAgeMs: 30 * DAY, minConfidence: 0.5 }, now);
    expect(pruned).toBe(1);
    const subjects = store.getActiveFacts().map(f => f.subject).sort();
    expect(subjects).toEqual(['fresh', 'strong']);
  });
});

describe('MemoryConsolidator', () => {
  let dir: string;
  let store: WarmMemoryStore;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ndcons2-test-'));
    store = new WarmMemoryStore(dir);
    await store.initialize();
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('runOnce merges and prunes in a single pass', () => {
    const now = Date.now();
    store.upsert({ kind: 'fact', subject: 'a', value: 'dup', confidence: 0.8 }, now);
    store.upsert({ kind: 'fact', subject: 'b', value: 'dup', confidence: 0.6 }, now);
    store.upsert({ kind: 'fact', subject: 'old', value: 'stale', confidence: 0.2 }, now - 40 * DAY);

    const c = new MemoryConsolidator(store, { maxAgeMs: 30 * DAY, minConfidence: 0.5 });
    const { merged, pruned } = c.runOnce(now);
    expect(merged).toBe(1);
    expect(pruned).toBe(1);
    expect(store.count()).toBe(1);
    expect(store.getActiveFacts()[0]?.value).toBe('dup');
  });

  it('start schedules the pass on an interval and stop clears it', () => {
    vi.useFakeTimers();
    try {
      const c = new MemoryConsolidator(store, { intervalMs: 1000 });
      const spy = vi.spyOn(c, 'runOnce');
      c.start();
      vi.advanceTimersByTime(3500);
      expect(spy).toHaveBeenCalledTimes(3);
      c.stop();
      vi.advanceTimersByTime(3000);
      expect(spy).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
