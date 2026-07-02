import { evaluate } from 'mathjs';
import type { Quote } from '@catdesk/shared-types';

export interface EvalResult {
  value: number | null;
  error?: string;
}

/** Moyenne mobile simple sur les `n` derniers points (utilise ce qui existe si moins). */
export function sma(values: number[], n: number): number {
  if (!Array.isArray(values) || values.length === 0 || n < 1) return NaN;
  const window = values.slice(-Math.floor(n));
  return window.reduce((a, b) => a + b, 0) / window.length;
}

/** Moyenne mobile exponentielle (k = 2/(n+1)) sur toute la série disponible. */
export function ema(values: number[], n: number): number {
  if (!Array.isArray(values) || values.length === 0 || n < 1) return NaN;
  const k = 2 / (Math.floor(n) + 1);
  let acc = values[0] as number;
  for (let i = 1; i < values.length; i++) {
    acc = (values[i] as number) * k + acc * (1 - k);
  }
  return acc;
}

/**
 * Construit le contexte d'évaluation : chaque symbole devient un objet
 * accessible par champ, ex. `AAPL.price`, `MSFT.changePercent`.
 *
 * B1 — formules glissantes : si `history` est fourni, chaque symbole expose
 * aussi `X.history` (série de prix, du plus ancien au plus récent) et le scope
 * gagne `sma(serie, n)` / `ema(serie, n)`. Exemples :
 *   `sma(AAPL.history, 20)` · `AAPL.price - sma(AAPL.history, 50)` ·
 *   `max(MSFT.history)` (fonctions mathjs natives utilisables aussi).
 */
export function buildScope(
  quotes: Quote[],
  history?: ReadonlyMap<string, number[]>,
): Record<string, unknown> {
  const scope: Record<string, unknown> = {};
  for (const q of quotes) {
    scope[q.symbol] = {
      price: q.price,
      change: q.change,
      changePercent: q.changePercent,
      volume: q.volume ?? 0,
      history: [...(history?.get(q.symbol) ?? [q.price])],
    };
  }
  scope['sma'] = sma;
  scope['ema'] = ema;
  return scope;
}

/**
 * Évalue une formule (langage mathjs, pas d'`eval` JS) contre un contexte.
 * Renvoie une erreur portée par la cellule plutôt que de jeter, pour ne jamais
 * casser le reste du tableau.
 */
export function evaluateFormula(expression: string, scope: Record<string, unknown>): EvalResult {
  try {
    const result: unknown = evaluate(expression, scope);
    if (typeof result === 'number' && Number.isFinite(result)) {
      return { value: result };
    }
    return { value: null, error: 'résultat non numérique' };
  } catch (e) {
    return { value: null, error: e instanceof Error ? e.message : "erreur d'évaluation" };
  }
}
