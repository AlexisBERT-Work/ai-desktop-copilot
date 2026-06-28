import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useDashboardStore } from '../dashboard/dashboardStore';
import type { Widget, WidgetFormula } from '@catdesk/shared-types';

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

/** Union (par nom) des formules configurées dans les widgets `stocks`. */
function collectFormulas(widgets: Widget[]): WidgetFormula[] {
  const byName = new Map<string, WidgetFormula>();
  for (const w of widgets) {
    if (w.type !== 'stocks') continue;
    const fs = w.config.formulas;
    if (!Array.isArray(fs)) continue;
    for (const f of fs) {
      if (f === null || typeof f !== 'object') continue;
      const o = f as { name?: unknown; expression?: unknown };
      if (
        typeof o.name === 'string' &&
        typeof o.expression === 'string' &&
        o.name.trim().length > 0 &&
        o.expression.trim().length > 0
      ) {
        byName.set(o.name.trim(), { name: o.name.trim(), expression: o.expression.trim() });
      }
    }
  }
  return [...byName.values()];
}

/**
 * Synchronise la config bourse du sidecar (watchlist + formules) avec ce
 * qu'affichent les widgets `stocks` : à chaque changement, envoie l'union des
 * symboles et des formules. Le sidecar devient ainsi piloté par l'UI. Un retry
 * différé couvre le cas où le sidecar n'est pas encore prêt au démarrage.
 */
export function useMarketWatchSync(): void {
  const widgets = useDashboardStore((s) => s.config.widgets);

  useEffect(() => {
    const symbols = collectSymbols(widgets);
    const formulas = collectFormulas(widgets);
    const send = () =>
      void invoke('set_market_watchlist', { symbols, formulas }).catch(() => {});
    send();
    const retry = setTimeout(send, 3500);
    return () => clearTimeout(retry);
  }, [widgets]);
}
