import { useMarketStore } from '../../market/marketStore';
import { readMetricConfig, resolveMetric, type MetricResult } from './metric';
import type { WidgetProps } from './types';

function format(value: number, unit?: string): string {
  if (unit === '%') return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
  return Number.isInteger(value) ? value.toLocaleString('fr-FR') : value.toFixed(2);
}

/**
 * Rendu pur d'un KPI / statistique à partir d'une métrique déjà résolue.
 * Sans dépendance au store → réutilisable (guide, tests).
 */
export function KpiView({ metric: m }: { metric: MetricResult }) {
  const valueColor =
    m.unit === '%' && m.value !== null
      ? m.value >= 0
        ? 'text-green-400'
        : 'text-red-400'
      : 'text-white/90';

  return (
    <div className="flex h-full flex-col justify-center">
      <span className="truncate text-xs text-white/40">{m.label}</span>
      {m.error !== undefined ? (
        <span className="text-sm text-red-400/80" title={m.error}>
          erreur
        </span>
      ) : m.value === null ? (
        <span className="text-2xl font-semibold tabular-nums text-white/25">—</span>
      ) : (
        <span className={`text-2xl font-semibold tabular-nums ${valueColor}`}>
          {format(m.value, m.unit)}
        </span>
      )}
      {m.changePercent !== undefined && m.unit !== '%' && (
        <span
          className={`text-xs tabular-nums ${m.changePercent >= 0 ? 'text-green-400' : 'text-red-400'}`}
        >
          {m.changePercent >= 0 ? '+' : ''}
          {m.changePercent.toFixed(2)}%
        </span>
      )}
    </div>
  );
}

/**
 * Widget KPI / statistique : une valeur unique (champ d'un symbole ou résultat
 * de formule), en grand, avec la variation du jour colorée.
 */
export function KpiWidget({ widget }: WidgetProps) {
  const quotes = useMarketStore((s) => s.quotes);
  const computed = useMarketStore((s) => s.computed);
  const m = resolveMetric(readMetricConfig(widget.config), quotes, computed);
  return <KpiView metric={m} />;
}
