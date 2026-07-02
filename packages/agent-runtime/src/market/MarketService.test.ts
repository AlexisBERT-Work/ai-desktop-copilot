import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MarketService } from './MarketService';
import type { MarketHistoryStore } from './MarketHistoryStore';
import type { Quote } from '@catdesk/shared-types';

vi.mock('./YahooQuoteSource', () => ({
  fetchQuotes: vi.fn(async (symbols: string[]) => {
    const map = new Map<string, Quote>();
    for (const s of symbols) {
      map.set(s, {
        symbol: s,
        price: 100,
        change: 0,
        changePercent: 0,
        currency: 'USD',
        marketTime: Date.now(),
      } as unknown as Quote);
    }
    return map;
  }),
}));

function makeStore(seed?: Map<string, number[]>) {
  return {
    loadAll: vi.fn(() => seed ?? new Map<string, number[]>()),
    appendMany: vi.fn(),
    deleteSymbol: vi.fn(),
  } as unknown as MarketHistoryStore & {
    loadAll: ReturnType<typeof vi.fn>;
    appendMany: ReturnType<typeof vi.fn>;
    deleteSymbol: ReturnType<typeof vi.fn>;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MarketService + MarketHistoryStore (B6)', () => {
  it('attachHistoryStore réamorce l’historique des symboles de la watchlist', () => {
    const service = new MarketService(['AAPL']);
    const store = makeStore(new Map([
      ['AAPL', [98, 99]],
      ['ZZZ', [1, 2]], // hors watchlist : ignoré
    ]));
    service.attachHistoryStore(store);
    expect(service.getHistory('AAPL')).toEqual([98, 99]);
    expect(service.getHistory('ZZZ')).toEqual([]);
  });

  it('refresh persiste les nouveaux points via appendMany', async () => {
    const service = new MarketService(['AAPL', 'MSFT']);
    const store = makeStore();
    service.attachHistoryStore(store);
    await service.refresh();
    expect(store.appendMany).toHaveBeenCalledWith([
      { symbol: 'AAPL', price: 100 },
      { symbol: 'MSFT', price: 100 },
    ]);
  });

  it('removeSymbol et setWatchlist purgent le store', () => {
    const service = new MarketService(['AAPL', 'MSFT', 'TSLA']);
    const store = makeStore();
    service.attachHistoryStore(store);

    service.removeSymbol('aapl');
    expect(store.deleteSymbol).toHaveBeenCalledWith('AAPL');

    service.setWatchlist(['TSLA']);
    expect(store.deleteSymbol).toHaveBeenCalledWith('MSFT');
  });

  it('fonctionne sans store (comportement historique inchangé)', async () => {
    const service = new MarketService(['AAPL']);
    const snap = await service.refresh();
    expect(snap.quotes.length).toBe(1);
    expect(service.getHistory('AAPL')).toEqual([100]);
  });
});
