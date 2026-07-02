import { describe, it, expect } from 'vitest';
import { buildScope, evaluateFormula, sma, ema } from './FormulaEngine';
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

describe('FormulaEngine — formules glissantes (B1)', () => {
  it('sma : moyenne des n derniers points, tolère une série courte', () => {
    expect(sma([1, 2, 3, 4], 2)).toBe(3.5);
    expect(sma([1, 2, 3, 4], 10)).toBe(2.5); // fenêtre > série : utilise tout
    expect(sma([], 5)).toBeNaN();
  });

  it('ema : converge vers les valeurs récentes', () => {
    expect(ema([100, 100, 100], 3)).toBe(100);
    const rising = ema([100, 110, 120], 3);
    expect(rising).toBeGreaterThan(sma([100, 110, 120], 3) - 5);
    expect(rising).toBeLessThanOrEqual(120);
    expect(ema([], 3)).toBeNaN();
  });

  it('expose X.history et sma/ema dans le scope', () => {
    const history = new Map([['AAPL', [100, 110, 120]]]);
    const scope = buildScope([quote('AAPL', 120)], history);
    expect(evaluateFormula('sma(AAPL.history, 3)', scope)).toEqual({ value: 110 });
    expect(evaluateFormula('AAPL.price - sma(AAPL.history, 2)', scope)).toEqual({ value: 5 });
    expect(evaluateFormula('max(AAPL.history) - min(AAPL.history)', scope)).toEqual({ value: 20 });
  });

  it('sans historique fourni : history = [prix courant] (les formules restent valides)', () => {
    const scope = buildScope([quote('MSFT', 400)]);
    expect(evaluateFormula('sma(MSFT.history, 20)', scope)).toEqual({ value: 400 });
  });
});
