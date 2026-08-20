import type { Quote } from '@catdesk/shared-types';
import { CircuitBreaker } from '../lib/CircuitBreaker';

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

/**
 * Coupe-circuit par symbole. Le poller tourne à la minute : sans lui, un symbole
 * invalide (titre radié, faute de frappe dans la watchlist) ou une panne Yahoo
 * repayait une requête complète à chaque cycle, pour toujours. Clé au symbole
 * plutôt qu'au domaine : ça couvre le cas courant (UN symbole cassé) sans
 * écarter toute la watchlist, et une panne globale ouvre chaque symbole en
 * trois cycles de toute façon.
 */
export const yahooBreaker = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 5 * 60 * 1000 });

/** Un échec DOIT lever ici : c'est ce que le coupe-circuit comptabilise. */
async function requestQuote(symbol: string): Promise<Quote | null> {
  const res = await fetch(`${ENDPOINT}${encodeURIComponent(symbol)}?interval=1d&range=1d`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json: unknown = await res.json();
  const quote = parseYahooChart(symbol, json);
  // Réponse 200 mais illisible (symbole inconnu de Yahoo) : c'est un échec
  // durable, pas un trou de données — sinon le circuit ne s'ouvrirait jamais.
  if (quote === null) throw new Error('réponse Yahoo inexploitable');
  return quote;
}

async function fetchQuote(symbol: string): Promise<Quote | null> {
  try {
    return await yahooBreaker.run(symbol, () => requestQuote(symbol));
  } catch {
    // Contrat inchangé pour l'appelant : un symbole en échec est simplement
    // absent du résultat, qu'il ait échoué ou été écarté par le circuit.
    return null;
  }
}

/** Récupère les cotations en parallèle. Les symboles en échec sont absents. */
export async function fetchQuotes(symbols: string[]): Promise<Map<string, Quote>> {
  const pairs = await Promise.all(symbols.map(async s => [s, await fetchQuote(s)] as const));
  const map = new Map<string, Quote>();
  for (const [s, q] of pairs) {
    if (q !== null) map.set(s, q);
  }
  return map;
}
