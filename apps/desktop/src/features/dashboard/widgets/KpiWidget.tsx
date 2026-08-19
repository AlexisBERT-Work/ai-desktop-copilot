import { useMarketStore } from '../../market/marketStore';
import { makeNumberFormat, useNumberFormat, type NumberFormat } from '../../appearance/format';
import { readMetricConfig, resolveMetric, type MetricResult } from './metric';
import type { WidgetProps } from './types';

/** Format par défaut (guide, aperçus) quand aucun n'est fourni. */
const DEFAULT_FORMAT = makeNumberFormat('fr-FR', 2, 'none');

/**
 * Rendu pur d'un KPI / statistique à partir d'une métrique déjà résolue.
 * Sans dépendance au store → réutilisable (guide, tests).
 */
export function KpiView({
  metric: m,
  fmt = DEFAULT_FORMAT,
}: {
  metric: MetricResult;
  fmt?: NumberFormat;
}) {
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
        // key = valeur : chaque tick de marché remonte la valeur avec une
        // micro-pulsation, signe visible que la donnée est vivante.
        <span
          key={m.value}
          className={`animate-value-tick text-2xl font-semibold tabular-nums ${valueColor}`}
        >
          {m.unit === '%' ? fmt.percent(m.value) : fmt.loose(m.value)}
        </span>
      )}
      {m.changePercent !== undefined && m.unit !== '%' && (
        <span
          className={`text-xs tabular-nums ${m.changePercent >= 0 ? 'text-green-400' : 'text-red-400'}`}
        >
          {fmt.percent(m.changePercent)}
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
  const quotes = useMarketStore(s => s.quotes);
  const computed = useMarketStore(s => s.computed);
  const fmt = useNumberFormat();
  const m = resolveMetric(readMetricConfig(widget.config), quotes, computed);
  return <KpiView metric={m} fmt={fmt} />;
}
