import { AlertTriangle, Sigma } from 'lucide-react';
import type { ComputedValue, Quote } from '@catdesk/shared-types';
import { useMarketStore } from '../../market/marketStore';
import { Sparkline } from '../../market/Sparkline';
import type { WidgetProps } from './types';

function readFormulaNames(config: Record<string, unknown>): string[] {
  const fs = config.formulas;
  if (!Array.isArray(fs)) return [];
  const names: string[] = [];
  for (const f of fs) {
    if (f !== null && typeof f === 'object') {
      const o = f as { name?: unknown };
      if (typeof o.name === 'string' && o.name.trim().length > 0) names.push(o.name.trim());
    }
  }
  return names;
}

interface StocksViewProps {
  symbols: string[];
  formulaNames: string[];
  quotes: Record<string, Quote>;
  computed: ComputedValue[];
  history: Record<string, number[]>;
}

/** Rendu pur du widget bourse (cotations + colonnes de formules). */
export function StocksView({ symbols, formulaNames, quotes, computed, history }: StocksViewProps) {
  if (symbols.length === 0 && formulaNames.length === 0) {
    return <p className="text-xs text-white/30">Aucun symbole ni formule configuré.</p>;
  }

  return (
    <div className="space-y-1.5">
      {symbols.map((sym) => {
        const key = sym.toUpperCase();
        const q = quotes[key];
        const hist = history[key] ?? [];
        return (
          <div key={sym} className="flex items-center justify-between gap-2 text-sm">
            <span className="font-medium text-white/80">{key}</span>
            <span className="flex items-center gap-2">
              {hist.length >= 2 && <Sparkline values={hist} />}
              {q ? (
                <span className="flex items-center gap-2 tabular-nums">
                  {/* key = prix : micro-pulsation à chaque tick de marché. */}
                  <span key={q.price} className="animate-value-tick text-white/80">
                    {q.price.toFixed(2)}
                  </span>
                  <span className={q.change >= 0 ? 'text-green-400' : 'text-red-400'}>
                    {q.change >= 0 ? '+' : ''}
                    {q.changePercent.toFixed(2)}%
                  </span>
                  {q.stale && (
                    <AlertTriangle
                      className="h-3.5 w-3.5 text-amber-400/70"
                      aria-label="Donnée non rafraîchie"
                    />
                  )}
                </span>
              ) : (
                <span className="tabular-nums text-white/25">—</span>
              )}
            </span>
          </div>
        );
      })}

      {formulaNames.length > 0 && (
        <div className="mt-1 space-y-1 border-t border-white/5 pt-1.5">
          {formulaNames.map((name) => {
            const c = computed.find((v) => v.name === name);
            return (
              <div key={name} className="flex items-center justify-between text-sm">
                <span className="flex min-w-0 items-center gap-1 truncate text-brand-300/90">
                  <Sigma className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  {name}
                </span>
                {c === undefined ? (
                  <span className="tabular-nums text-white/25">—</span>
                ) : c.error !== undefined || c.value === null ? (
                  <span className="text-red-400/80" title={c.error ?? 'erreur'}>
                    erreur
                  </span>
                ) : (
                  <span className="tabular-nums text-white/85">
                    {Number.isInteger(c.value) ? c.value : c.value.toFixed(4)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Widget bourse — cotations en direct + colonnes de formules (provider `market`
 * du sidecar, poussé via `market:update`). Symboles et formules de la config
 * sont synchronisés vers le sidecar (voir useMarketWatchSync) ; les valeurs
 * calculées reviennent dans `computed` et sont matchées par nom.
 */
export function StocksWidget({ widget }: WidgetProps) {
  const quotes = useMarketStore((s) => s.quotes);
  const computed = useMarketStore((s) => s.computed);
  const history = useMarketStore((s) => s.history);

  const symbols = Array.isArray(widget.config.symbols)
    ? widget.config.symbols.filter((s): s is string => typeof s === 'string')
    : [];
  const formulaNames = readFormulaNames(widget.config);

  return (
    <StocksView
      symbols={symbols}
      formulaNames={formulaNames}
      quotes={quotes}
      computed={computed}
      history={history}
    />
  );
}
