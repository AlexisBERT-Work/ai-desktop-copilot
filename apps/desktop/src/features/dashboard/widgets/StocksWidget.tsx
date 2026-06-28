import { useMarketStore } from '../../market/marketStore';
import type { WidgetProps } from './types';

/**
 * Widget bourse — cotations en direct (provider `market` du sidecar, poussé via
 * l'event `market:update`). Les symboles à afficher viennent de la config du
 * widget ; ils doivent être dans la watchlist du sidecar pour avoir une valeur
 * (les ajouter via l'agent : « ajoute TSLA à ma watchlist »).
 */
export function StocksWidget({ widget }: WidgetProps) {
  const quotes = useMarketStore((s) => s.quotes);

  const symbols = Array.isArray(widget.config.symbols)
    ? widget.config.symbols.filter((s): s is string => typeof s === 'string')
    : [];

  if (symbols.length === 0) {
    return <p className="text-xs text-white/30">Aucun symbole configuré.</p>;
  }

  return (
    <div className="space-y-1.5">
      {symbols.map((sym) => {
        const q = quotes[sym.toUpperCase()];
        return (
          <div key={sym} className="flex items-center justify-between text-sm">
            <span className="font-medium text-white/80">{sym.toUpperCase()}</span>
            {q ? (
              <span className="flex items-center gap-2 tabular-nums">
                <span className="text-white/80">{q.price.toFixed(2)}</span>
                <span className={q.change >= 0 ? 'text-green-400' : 'text-red-400'}>
                  {q.change >= 0 ? '+' : ''}
                  {q.changePercent.toFixed(2)}%
                </span>
                {q.stale && (
                  <span className="text-amber-400/70" title="Donnée non rafraîchie">
                    ⚠
                  </span>
                )}
              </span>
            ) : (
              <span className="tabular-nums text-white/25">—</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
