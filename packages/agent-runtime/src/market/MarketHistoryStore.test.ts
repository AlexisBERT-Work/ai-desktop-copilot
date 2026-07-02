import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { MarketHistoryStore } from './MarketHistoryStore';

let dir: string;
let prevDataDir: string | undefined;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'catdesk-mkt-'));
  prevDataDir = process.env['CATDESK_DATA_DIR'];
  process.env['CATDESK_DATA_DIR'] = dir;
});

afterEach(async () => {
  if (prevDataDir === undefined) delete process.env['CATDESK_DATA_DIR'];
  else process.env['CATDESK_DATA_DIR'] = prevDataDir;
  await rm(dir, { recursive: true, force: true });
});

describe('MarketHistoryStore', () => {
  it('append + load : ordre chronologique, symbole normalisé', async () => {
    const store = new MarketHistoryStore();
    await store.initialize();
    store.appendMany([
      { symbol: 'aapl', price: 100, ts: 1000 },
      { symbol: 'AAPL', price: 101, ts: 2000 },
      { symbol: 'AAPL', price: 102, ts: 3000 },
    ]);
    const points = store.load('AAPL');
    expect(points.map(p => p.price)).toEqual([100, 101, 102]);
    expect(points.map(p => p.ts)).toEqual([1000, 2000, 3000]);
    store.close();
  });

  it('load respecte limit (les plus récents)', async () => {
    const store = new MarketHistoryStore();
    await store.initialize();
    store.appendMany([1, 2, 3, 4, 5].map(i => ({ symbol: 'X', price: i, ts: i * 1000 })));
    expect(store.load('X', 2).map(p => p.price)).toEqual([4, 5]);
    store.close();
  });

  it('persiste sur disque et survit à un rechargement', async () => {
    const a = new MarketHistoryStore();
    await a.initialize();
    a.appendMany([{ symbol: 'MSFT', price: 420, ts: 1 }]);
    a.close();

    const b = new MarketHistoryStore();
    await b.initialize();
    expect(b.load('MSFT').map(p => p.price)).toEqual([420]);
    b.close();
  });

  it('élague au-delà du plafond par symbole', async () => {
    const store = new MarketHistoryStore(3);
    await store.initialize();
    store.appendMany([1, 2, 3, 4, 5].map(i => ({ symbol: 'Y', price: i, ts: i * 1000 })));
    expect(store.load('Y', 100).map(p => p.price)).toEqual([3, 4, 5]);
    store.close();
  });

  it('deleteSymbol supprime tout, loadAll regroupe par symbole', async () => {
    const store = new MarketHistoryStore();
    await store.initialize();
    store.appendMany([
      { symbol: 'A', price: 1, ts: 1 },
      { symbol: 'B', price: 2, ts: 1 },
      { symbol: 'B', price: 3, ts: 2 },
    ]);
    const all = store.loadAll();
    expect(all.get('A')).toEqual([1]);
    expect(all.get('B')).toEqual([2, 3]);

    store.deleteSymbol('B');
    expect(store.load('B')).toEqual([]);
    expect(store.load('A').length).toBe(1);
    store.close();
  });
});
