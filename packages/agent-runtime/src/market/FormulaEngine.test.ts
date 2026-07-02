import { describe, it, expect } from 'vitest';
import { buildScope, evaluateFormula } from './FormulaEngine';
import type { Quote } from '@catdesk/shared-types';

function quote(symbol: string, price: number, change = 0): Quote {
  return {
    symbol,
    price,
    change,
    changePercent: price !== 0 ? (change / price) * 100 : 0,
    volume: 1000,
    currency: 'USD',
    source: 'test',
    timestamp: 0,
    stale: false,
  };
}

describe('FormulaEngine', () => {
  const scope = buildScope([quote('AAPL', 200, 4), quote('MSFT', 400, -2)]);

  it('évalue une formule croisée (ratio entre deux symboles)', () => {
    expect(evaluateFormula('AAPL.price / MSFT.price', scope)).toEqual({ value: 0.5 });
  });

  it('évalue une formule par champ', () => {
    expect(evaluateFormula('AAPL.change * 2', scope)).toEqual({ value: 8 });
  });

  it('supporte les fonctions mathjs', () => {
    expect(evaluateFormula('max(AAPL.price, MSFT.price)', scope)).toEqual({ value: 400 });
  });

  it('renvoie une erreur sur expression invalide, sans jeter', () => {
    const r = evaluateFormula('AAPL.price / (', scope);
    expect(r.value).toBeNull();
    expect(r.error).toBeTruthy();
  });

  it('renvoie une erreur sur symbole inconnu', () => {
    const r = evaluateFormula('NOPE.price', scope);
    expect(r.value).toBeNull();
    expect(r.error).toBeTruthy();
  });

  it('signale un résultat non numérique', () => {
    const r = evaluateFormula('"texte"', scope);
    expect(r.value).toBeNull();
    expect(r.error).toBe('résultat non numérique');
  });
});
