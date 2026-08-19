import type { Quote } from '@catdesk/shared-types';
import { useMarketStore } from '../../market/marketStore';
import { Sparkline } from '../../market/Sparkline';
import { makeNumberFormat, useNumberFormat, type NumberFormat } from '../../appearance/format';
import type { WidgetProps } from './types';

const DEFAULT_FORMAT = makeNumberFormat('fr-FR', 2, 'none');

interface ChartViewProps {
  symbol: string;
  quote: Quote | null;
  history: number[];
  fmt?: NumberFormat;
}

/** Rendu pur d'un graphe (prix + courbe) — sans dépendance au store. */
export function ChartView({
  symbol: sym,
  quote: q,
  history: hist,
  fmt = DEFAULT_FORMAT,
}: ChartViewProps) {
  if (sym === '') return <p className="text-xs text-white/30">Aucun symbole configuré.</p>;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-baseline justify-between">
        <span className="font-medium text-white/80">{sym}</span>
        {q !== null && (
          <span className="flex items-center gap-2 text-xs tabular-nums">
            <span className="text-white/70">{fmt.price(q.price)}</span>
            <span className={q.change >= 0 ? 'text-green-400' : 'text-red-400'}>
              {fmt.percent(q.changePercent)}
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

/** Widget graphe : courbe du prix d'un symbole sur l'historique récent. */
export function ChartWidget({ widget }: WidgetProps) {
  const quotes = useMarketStore(s => s.quotes);
  const history = useMarketStore(s => s.history);
  const fmt = useNumberFormat();

  const sym = typeof widget.config.symbol === 'string' ? widget.config.symbol.toUpperCase() : '';
  return (
    <ChartView symbol={sym} quote={quotes[sym] ?? null} history={history[sym] ?? []} fmt={fmt} />
  );
}
