import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { WarmMemoryStore } from './WarmMemoryStore';

describe('WarmMemoryStore', () => {
  let dir: string;
  let store: WarmMemoryStore;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ndwarm-test-'));
    store = new WarmMemoryStore(dir);
    await store.initialize();
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('inserts a new fact', () => {
    const changed = store.upsert({ kind: 'preference', subject: 'editeur', value: 'préfère VS Code' });
    expect(changed).toBe(true);
    expect(store.count()).toBe(1);
    expect(store.getActiveFacts()[0]?.value).toBe('préfère VS Code');
  });

  it('normalizes subject to lowercase and ignores empty input', () => {
    expect(store.upsert({ kind: 'fact', subject: '  Stack  ', value: 'Rust' })).toBe(true);
    expect(store.upsert({ kind: 'fact', subject: 'x', value: '   ' })).toBe(false);
    expect(store.getActiveFacts()[0]?.subject).toBe('stack');
    expect(store.count()).toBe(1);
  });

  it('reaffirming the same subject+value does not add a row', () => {
    store.upsert({ kind: 'preference', subject: 'editeur', value: 'VS Code', confidence: 0.6 });
    const changed = store.upsert({ kind: 'preference', subject: 'editeur', value: 'vs code', confidence: 0.9 });
    expect(changed).toBe(false);
    expect(store.count()).toBe(1);
    // confidence is bumped to the higher value
    expect(store.getActiveFacts()[0]?.confidence).toBe(0.9);
  });

  it('supersedes the old value on contradiction (same subject, new value)', () => {
    store.upsert({ kind: 'fact', subject: 'employeur', value: 'travaille chez X' });
    const changed = store.upsert({ kind: 'fact', subject: 'employeur', value: 'ne travaille plus chez X' });
    expect(changed).toBe(true);
    expect(store.count()).toBe(1); // old one retired, not piled up
    expect(store.getActiveFacts()[0]?.value).toBe('ne travaille plus chez X');
  });

  it('keeps distinct subjects side by side', () => {
    store.upsert({ kind: 'preference', subject: 'editeur', value: 'VS Code' });
    store.upsert({ kind: 'fact', subject: 'stack', value: 'Rust + React' });
    expect(store.count()).toBe(2);
  });

  it('persists facts across reopen', async () => {
    store.upsert({ kind: 'fact', subject: 'stack', value: 'Rust' });
    store.close();

    const reopened = new WarmMemoryStore(dir);
    await reopened.initialize();
    expect(reopened.count()).toBe(1);
    expect(reopened.getActiveFacts()[0]?.value).toBe('Rust');
    reopened.close();
  });
});
