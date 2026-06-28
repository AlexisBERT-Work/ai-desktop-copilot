import type { ComputedValue, Quote } from '@catdesk/shared-types';

export type QuoteField = 'price' | 'change' | 'changePercent' | 'volume';

export const QUOTE_FIELDS: readonly QuoteField[] = ['price', 'change', 'changePercent', 'volume'];

export interface MetricConfig {
  symbol?: string;
  field?: QuoteField;
  formula?: string;
  label?: string;
}

export interface MetricResult {
  value: number | null;
  label: string;
  /** Variation du jour (%) pour la coloration, quand la métrique vient d'un symbole. */
  changePercent?: number;
  /** '%' quand la valeur est déjà un pourcentage. */
  unit?: string;
  error?: string;
}

function isField(x: unknown): x is QuoteField {
  return typeof x === 'string' && (QUOTE_FIELDS as readonly string[]).includes(x);
}

/** Lit la config d'un widget métrique (kpi/stat) de façon défensive. */
export function readMetricConfig(config: Record<string, unknown>): MetricConfig {
  const c: MetricConfig = {};
  if (typeof config.symbol === 'string' && config.symbol.trim()) c.symbol = config.symbol.trim().toUpperCase();
  if (isField(config.field)) c.field = config.field;
  if (typeof config.formula === 'string' && config.formula.trim()) c.formula = config.formula.trim();
  if (typeof config.label === 'string' && config.label.trim()) c.label = config.label.trim();
  return c;
}

/**
 * Résout une métrique : soit la valeur d'une formule (par nom), soit un champ
 * d'un symbole. Pur et testable.
 */
export function resolveMetric(
  config: MetricConfig,
  quotes: Record<string, Quote>,
  computed: ComputedValue[],
): MetricResult {
  if (config.formula !== undefined) {
    const c = computed.find((v) => v.name === config.formula);
    const label = config.label ?? config.formula;
    if (c === undefined) return { value: null, label };
    return c.error !== undefined
      ? { value: c.value, label, error: c.error }
      : { value: c.value, label };
  }

  const field: QuoteField = config.field ?? 'price';
  const sym = config.symbol;
  if (sym === undefined) return { value: null, label: config.label ?? 'KPI' };

  const label = config.label ?? `${sym} · ${field}`;
  const q = quotes[sym];
  if (q === undefined) return { value: null, label };

  const raw = q[field];
  const result: MetricResult = {
    value: typeof raw === 'number' ? raw : null,
    label,
    changePercent: q.changePercent,
  };
  if (field === 'changePercent') result.unit = '%';
  return result;
}
