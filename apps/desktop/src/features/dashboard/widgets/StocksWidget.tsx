import type { WidgetProps } from './types';

/**
 * Widget bourse — ossature seulement. Affiche les symboles configurés ;
 * les données live (provider `market`) sont câblées en P3.
 */
export function StocksWidget({ widget }: WidgetProps) {
  const symbols = Array.isArray(widget.config.symbols)
    ? widget.config.symbols.filter((s): s is string => typeof s === 'string')
    : [];

  if (symbols.length === 0) {
    return <p className="text-xs text-white/30">Aucun symbole configuré.</p>;
  }

  return (
    <div className="space-y-1.5">
      {symbols.map((sym) => (
        <div key={sym} className="flex items-center justify-between text-sm">
          <span className="font-medium text-white/80">{sym}</span>
          <span className="tabular-nums text-xs text-white/30">— · live en P3</span>
        </div>
      ))}
    </div>
  );
}
