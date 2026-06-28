import type { Quote } from '@catdesk/shared-types';
import { useMarketStore } from '../../market/marketStore';
import type { WidgetProps } from './types';

interface TableViewProps {
  symbols: string[];
  quotes: Record<string, Quote>;
}

/** Rendu pur d'une table de cotations — sans dépendance au store. */
export function TableView({ symbols, quotes }: TableViewProps) {
  if (symbols.length === 0) {
    return <p className="text-xs text-white/30">Aucun symbole configuré.</p>;
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-xs text-white/40">
          <th className="text-left font-medium">Symbole</th>
          <th className="text-right font-medium">Prix</th>
          <th className="text-right font-medium">Var %</th>
          <th className="text-right font-medium">Volume</th>
        </tr>
      </thead>
      <tbody>
        {symbols.map((sym) => {
          const q = quotes[sym.toUpperCase()];
          return (
            <tr key={sym} className="border-t border-white/5">
              <td className="py-1 font-medium text-white/80">{sym.toUpperCase()}</td>
              <td className="py-1 text-right tabular-nums text-white/80">
                {q !== undefined ? q.price.toFixed(2) : '—'}
              </td>
              <td
                className={`py-1 text-right tabular-nums ${
                  q !== undefined ? (q.change >= 0 ? 'text-green-400' : 'text-red-400') : 'text-white/25'
                }`}
              >
                {q !== undefined ? `${q.change >= 0 ? '+' : ''}${q.changePercent.toFixed(2)}%` : '—'}
              </td>
              <td className="py-1 text-right tabular-nums text-white/50">
                {q !== undefined && q.volume !== null ? q.volume.toLocaleString('fr-FR') : '—'}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Widget table : plusieurs symboles avec prix / variation / volume. */
export function TableWidget({ widget }: WidgetProps) {
  const quotes = useMarketStore((s) => s.quotes);
  const symbols = Array.isArray(widget.config.symbols)
    ? widget.config.symbols.filter((s): s is string => typeof s === 'string')
    : [];
  return <TableView symbols={symbols} quotes={quotes} />;
}
