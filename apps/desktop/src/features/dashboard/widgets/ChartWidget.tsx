import { useMarketStore } from '../../market/marketStore';
import { Sparkline } from '../../market/Sparkline';
import type { WidgetProps } from './types';

/** Widget graphe : courbe du prix d'un symbole sur l'historique récent. */
export function ChartWidget({ widget }: WidgetProps) {
  const quotes = useMarketStore((s) => s.quotes);
  const history = useMarketStore((s) => s.history);

  const sym = typeof widget.config.symbol === 'string' ? widget.config.symbol.toUpperCase() : '';
  if (sym === '') return <p className="text-xs text-white/30">Aucun symbole configuré.</p>;

  const hist = history[sym] ?? [];
  const q = quotes[sym];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-baseline justify-between">
        <span className="font-medium text-white/80">{sym}</span>
        {q !== undefined && (
          <span className="flex items-center gap-2 text-xs tabular-nums">
            <span className="text-white/70">{q.price.toFixed(2)}</span>
            <span className={q.change >= 0 ? 'text-green-400' : 'text-red-400'}>
              {q.change >= 0 ? '+' : ''}
              {q.changePercent.toFixed(2)}%
            </span>
          </span>
        )}
      </div>
      <div className="mt-2 flex flex-1 items-end">
        {hist.length >= 2 ? (
          <Sparkline values={hist} width={260} height={90} />
        ) : (
          <p className="text-xs text-white/30">Historique en cours de constitution…</p>
        )}
      </div>
    </div>
  );
}
