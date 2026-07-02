import type { Quote } from '@catdesk/shared-types';

// Endpoint chart public de Yahoo : pas de crumb/cookie requis, une requête par
// symbole. Suffisant à la cadence ~1 min pour une watchlist de quelques dizaines
// de titres. Voir docs/projects/dashboard-platform.md §6.4.
const ENDPOINT = 'https://query1.finance.yahoo.com/v8/finance/chart/';

function num(x: unknown): number | null {
  return typeof x === 'number' && Number.isFinite(x) ? x : null;
}

function readMeta(json: unknown): Record<string, unknown> | null {
  if (json === null || typeof json !== 'object') return null;
  const chart = (json as { chart?: unknown }).chart;
  if (chart === null || typeof chart !== 'object') return null;
  const result = (chart as { result?: unknown }).result;
  if (!Array.isArray(result) || result.length === 0) return null;
  const first: unknown = result[0];
  if (first === null || typeof first !== 'object') return null;
  const meta = (first as { meta?: unknown }).meta;
  if (meta === null || typeof meta !== 'object') return null;
  return meta as Record<string, unknown>;
}

/** Convertit la réponse JSON Yahoo en `Quote`. Pur et testable. */
export function parseYahooChart(symbol: string, json: unknown): Quote | null {
  const meta = readMeta(json);
  if (meta === null) return null;

  const price = num(meta['regularMarketPrice']);
  if (price === null) return null;

  const prev = num(meta['chartPreviousClose']) ?? num(meta['previousClose']);
  const change = prev !== null ? price - prev : 0;
  const changePercent = prev !== null && prev !== 0 ? (change / prev) * 100 : 0;
  const t = num(meta['regularMarketTime']);

  return {
    symbol: typeof meta['symbol'] === 'string' ? meta['symbol'] : symbol,
    price,
    change,
    changePercent,
    volume: num(meta['regularMarketVolume']),
    currency: typeof meta['currency'] === 'string' ? meta['currency'] : 'USD',
    source: 'yahoo',
    timestamp: t !== null ? t * 1000 : Date.now(),
    stale: false,
  };
}

async function fetchQuote(symbol: string): Promise<Quote | null> {
  try {
    const res = await fetch(`${ENDPOINT}${encodeURIComponent(symbol)}?interval=1d&range=1d`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!res.ok) return null;
    const json: unknown = await res.json();
    return parseYahooChart(symbol, json);
  } catch {
    return null;
  }
}

/** Récupère les cotations en parallèle. Les symboles en échec sont absents. */
export async function fetchQuotes(symbols: string[]): Promise<Map<string, Quote>> {
  const pairs = await Promise.all(
    symbols.map(async (s) => [s, await fetchQuote(s)] as const),
  );
  const map = new Map<string, Quote>();
  for (const [s, q] of pairs) {
    if (q !== null) map.set(s, q);
  }
  return map;
}
