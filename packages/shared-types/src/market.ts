// ─── Market / Bourse (Pilier A, module bourse) ─────────────────
// Cotations normalisées + formules, partagées entre le sidecar (provider) et
// l'UI (widget `stocks`). Voir docs/projects/dashboard-platform.md §6.

/** Cotation normalisée, indépendante de la source. */
export interface Quote {
  symbol: string;
  price: number;
  change: number; // variation absolue sur la journée
  changePercent: number;
  volume: number | null;
  currency: string;
  source: string; // 'yahoo', 'web'…
  timestamp: number; // epoch ms du point de donnée
  stale: boolean; // true si la dernière récupération a échoué
}

/** Une ligne suivie dans la watchlist. */
export interface WatchlistItem {
  symbol: string;
  label?: string;
}

/** Une formule définie par l'utilisateur, recalculée à chaque tick. */
export interface FormulaCell {
  id: string;
  name: string;
  expression: string;
}

/** Résultat d'évaluation d'une formule sur un tick. */
export interface ComputedValue {
  id: string;
  name: string;
  value: number | null;
  error?: string;
}

/** Instantané poussé à l'UI à chaque rafraîchissement. */
export interface MarketSnapshot {
  quotes: Quote[];
  computed: ComputedValue[];
  timestamp: number;
}
