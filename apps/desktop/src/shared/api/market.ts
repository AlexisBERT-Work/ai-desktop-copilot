import { invoke } from '@tauri-apps/api/core';

export interface FormulaDef {
  name: string;
  expression: string;
}

/**
 * Remplace la config bourse du sidecar (watchlist + formules des widgets stocks)
 * et, optionnellement, la période de rafraîchissement choisie dans Apparence.
 */
export function setMarketWatchlist(
  symbols: string[],
  formulas: FormulaDef[],
  intervalSecs?: number,
): Promise<void> {
  return invoke('set_market_watchlist', { symbols, formulas, intervalSecs: intervalSecs ?? null });
}
