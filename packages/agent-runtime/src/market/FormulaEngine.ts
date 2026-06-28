import { evaluate } from 'mathjs';
import type { Quote } from '@catdesk/shared-types';

export interface EvalResult {
  value: number | null;
  error?: string;
}

/**
 * Construit le contexte d'évaluation : chaque symbole devient un objet
 * accessible par champ, ex. `AAPL.price`, `MSFT.changePercent`.
 */
export function buildScope(quotes: Quote[]): Record<string, unknown> {
  const scope: Record<string, unknown> = {};
  for (const q of quotes) {
    scope[q.symbol] = {
      price: q.price,
      change: q.change,
      changePercent: q.changePercent,
      volume: q.volume ?? 0,
    };
  }
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
