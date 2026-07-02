import type { ComputedValue, Daily, NewsItem, Quote } from '@catdesk/shared-types';

// ─── Données d'exemple pour le guide des widgets ───────────────
// Déterministes (aucun aléa) afin que le PDF exporté soit toujours identique.
// Elles ne touchent pas aux stores : les vues pures des widgets les reçoivent
// directement en props.

function quote(symbol: string, price: number, change: number, volume: number): Quote {
  return {
    symbol,
    price,
    change,
    changePercent: (change / (price - change)) * 100,
    volume,
    currency: 'USD',
    source: 'exemple',
    timestamp: 0,
    stale: false,
  };
}

export const SAMPLE_QUOTES: Record<string, Quote> = {
  AAPL: quote('AAPL', 229.87, 2.14, 48_230_100),
  MSFT: quote('MSFT', 467.12, -1.85, 19_880_400),
  TSLA: quote('TSLA', 248.5, 6.3, 92_110_700),
  NVDA: quote('NVDA', 124.3, 3.05, 240_500_000),
};

/** Série de prix lisse et déterministe (tendance = signe de `drift`). */
function series(base: number, drift: number, n = 40): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const wave = Math.sin(i / 3.5) * base * 0.005;
    const trend = (i / (n - 1)) * drift;
    out.push(Number((base + wave + trend).toFixed(2)));
  }
  return out;
}

export const SAMPLE_HISTORY: Record<string, number[]> = {
  AAPL: series(227.73, 2.14),
  MSFT: series(468.97, -1.85),
  TSLA: series(242.2, 6.3),
  NVDA: series(121.25, 3.05),
};

export const SAMPLE_COMPUTED: ComputedValue[] = [
  { id: 'f1', name: 'AAPL/MSFT', value: 229.87 / 467.12 },
  { id: 'f2', name: 'Panier', value: (229.87 + 467.12 + 248.5) / 3 },
];

export const SAMPLE_NEWS: NewsItem[] = [
  {
    id: 'n1',
    title: 'Volatilité élevée sur les valeurs tech',
    body: 'Surveillez les **stops** : amplitude inhabituelle ce matin.',
    severity: 'warning',
    audienceClientId: null,
    publishedAt: '2026-06-29T07:30:00.000Z',
    expiresAt: null,
  },
  {
    id: 'n2',
    title: 'Nouvelle version 1.4 disponible',
    body: 'Widgets graphiques et formules glissantes ajoutés.',
    severity: 'success',
    audienceClientId: null,
    publishedAt: '2026-06-28T09:00:00.000Z',
    expiresAt: null,
  },
  {
    id: 'n3',
    title: 'Maintenance planifiée dimanche 02:00',
    body: 'Interruption courte du flux de cotations prévue.',
    severity: 'info',
    audienceClientId: null,
    publishedAt: '2026-06-27T18:00:00.000Z',
    expiresAt: null,
  },
];

export const SAMPLE_DAILIES: Daily[] = [
  {
    id: 'd1',
    title: 'Ouverture US : futures en hausse',
    body: 'Le **S&P 500** ouvre +0,6 %. Focus sur les semis après NVDA.',
    category: 'markets',
    publishedAt: '2026-06-29T07:30:00.000Z',
    expiresAt: null,
  },
  {
    id: 'd2',
    title: 'IA : nouveau modèle open-weights',
    body: 'Un acteur publie un modèle compétitif sous licence permissive.',
    category: 'tech',
    publishedAt: '2026-06-29T06:50:00.000Z',
    expiresAt: null,
  },
  {
    id: 'd3',
    title: 'BTC consolide sous 70k$',
    body: 'Volatilité en baisse, volumes faibles avant la clôture mensuelle.',
    category: 'crypto',
    publishedAt: '2026-06-28T20:10:00.000Z',
    expiresAt: null,
  },
];
