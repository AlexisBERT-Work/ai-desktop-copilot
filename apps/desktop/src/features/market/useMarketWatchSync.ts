import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useDashboardStore } from '../dashboard/dashboardStore';
import type { Widget } from '@catdesk/shared-types';

/** Union des symboles configurés dans tous les widgets `stocks`. */
function collectSymbols(widgets: Widget[]): string[] {
  const set = new Set<string>();
  for (const w of widgets) {
    if (w.type !== 'stocks') continue;
    const syms = w.config.symbols;
    if (!Array.isArray(syms)) continue;
    for (const s of syms) {
      if (typeof s === 'string' && s.trim().length > 0) set.add(s.trim().toUpperCase());
    }
  }
  return [...set];
}

/**
 * Synchronise la watchlist du sidecar avec les symboles affichés dans le
 * dashboard : à chaque changement de config, envoie l'union des symboles des
 * widgets `stocks` au sidecar (qui devient ainsi piloté par l'UI). Un retry
 * différé couvre le cas où le sidecar n'est pas encore prêt au démarrage.
 */
export function useMarketWatchSync(): void {
  const widgets = useDashboardStore((s) => s.config.widgets);

  useEffect(() => {
    const symbols = collectSymbols(widgets);
    const send = () => void invoke('set_market_watchlist', { symbols }).catch(() => {});
    send();
    const retry = setTimeout(send, 3500);
    return () => clearTimeout(retry);
  }, [widgets]);
}
