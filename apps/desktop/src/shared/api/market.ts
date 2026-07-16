import { invoke } from '@tauri-apps/api/core';

export interface FormulaDef {
  name: string;
  expression: string;
}

/** Remplace la config bourse du sidecar (watchlist + formules des widgets stocks). */
export function setMarketWatchlist(symbols: string[], formulas: FormulaDef[]): Promise<void> {
  return invoke('set_market_watchlist', { symbols, formulas });
}
