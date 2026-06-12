import { describe, it, expect } from 'vitest';
import { stepsRemaining, pickMidpoint, type Candidate } from './BisectGuidedTool';

describe('stepsRemaining', () => {
  it('vaut 0 pour une plage vide', () => {
    expect(stepsRemaining(0)).toBe(0);
  });

  it('croît en log2', () => {
    expect(stepsRemaining(1)).toBe(1);
    expect(stepsRemaining(7)).toBe(3);
    expect(stepsRemaining(15)).toBe(4);
    expect(stepsRemaining(1000)).toBe(10);
  });
});

describe('pickMidpoint', () => {
  const mk = (n: number): Candidate[] =>
    Array.from({ length: n }, (_, i) => ({ hash: `h${i}`, subject: `c${i}` }));

  it('retourne null pour une liste vide', () => {
    expect(pickMidpoint([])).toBeNull();
  });

  it('choisit le point milieu', () => {
    expect(pickMidpoint(mk(4))?.hash).toBe('h2');
    expect(pickMidpoint(mk(5))?.hash).toBe('h2');
    expect(pickMidpoint(mk(1))?.hash).toBe('h0');
  });
});
