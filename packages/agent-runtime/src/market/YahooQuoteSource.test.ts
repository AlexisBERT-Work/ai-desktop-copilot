import { describe, it, expect } from 'vitest';
import { parseYahooChart } from './YahooQuoteSource';

// Forme réelle (réduite) de la réponse v8/finance/chart de Yahoo.
const fixture = {
  chart: {
    result: [
      {
        meta: {
          currency: 'USD',
          symbol: 'AAPL',
          regularMarketPrice: 283.78,
          chartPreviousClose: 275.15,
          regularMarketVolume: 261244321,
          regularMarketTime: 1782504002,
        },
      },
    ],
  },
};

describe('parseYahooChart', () => {
  it('extrait une cotation normalisée', () => {
    const q = parseYahooChart('AAPL', fixture);
    expect(q).not.toBeNull();
    expect(q?.symbol).toBe('AAPL');
    expect(q?.price).toBe(283.78);
    expect(q?.currency).toBe('USD');
    expect(q?.volume).toBe(261244321);
    expect(q?.timestamp).toBe(1782504002 * 1000);
    expect(q?.stale).toBe(false);
    // change = price - previousClose
    expect(q?.change).toBeCloseTo(8.63, 2);
    expect(q?.changePercent).toBeCloseTo((8.63 / 275.15) * 100, 4);
  });

  it('retombe sur le symbole demandé si absent du meta', () => {
    const q = parseYahooChart('MSFT', {
      chart: { result: [{ meta: { regularMarketPrice: 400 } }] },
    });
    expect(q?.symbol).toBe('MSFT');
    expect(q?.currency).toBe('USD'); // défaut
    expect(q?.change).toBe(0); // pas de previousClose
  });

  it('renvoie null sur JSON malformé', () => {
    expect(parseYahooChart('AAPL', {})).toBeNull();
    expect(parseYahooChart('AAPL', { chart: { result: [] } })).toBeNull();
    expect(parseYahooChart('AAPL', null)).toBeNull();
    expect(parseYahooChart('AAPL', { chart: { result: [{ meta: {} }] } })).toBeNull();
  });
});
