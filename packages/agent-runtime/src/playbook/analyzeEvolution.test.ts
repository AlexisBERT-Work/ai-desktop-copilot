import { describe, it, expect } from 'vitest';
import { analyzeEvolution } from './analyzeEvolution';
import type { StrategyRow } from './PlaybookStore';

function row(taskType: string, approach: string, successes: number, failures: number): StrategyRow {
  return { taskType, approach, successes, failures, updatedAt: 1 };
}

describe('analyzeEvolution', () => {
  it('returns nothing without enough signal', () => {
    // Below the default minAttempts of 3.
    expect(analyzeEvolution([row('debug', 'a>b', 1, 1)])).toEqual([]);
  });

  it('proposes preferring a clear winner', () => {
    const p = analyzeEvolution([row('tests', 'generate_unit_tests', 5, 1)]);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ kind: 'prefer', taskType: 'tests', approach: 'generate_unit_tests' });
    expect(p[0]!.successRate).toBeCloseTo(5 / 6);
    expect(p[0]!.rationale).toContain('privilégier');
  });

  it('proposes avoiding a failing approach and points at the winner', () => {
    const p = analyzeEvolution([
      row('debug', 'good>flow', 8, 1),
      row('debug', 'bad>flow', 1, 5),
    ]);
    const prefer = p.find(x => x.kind === 'prefer');
    const avoid = p.find(x => x.kind === 'avoid');
    expect(prefer?.approach).toBe('good>flow');
    expect(avoid).toMatchObject({ approach: 'bad>flow', betterApproach: 'good>flow' });
    expect(avoid!.rationale).toContain('préférer « good>flow »');
  });

  it('does not flag a middling approach as avoid', () => {
    // 50% is above badRate (0.4) and below goodRate (0.6): neither prefer nor avoid.
    const p = analyzeEvolution([
      row('search', 'winner', 9, 1),
      row('search', 'middling', 3, 3),
    ]);
    expect(p.some(x => x.approach === 'middling')).toBe(false);
    expect(p.filter(x => x.kind === 'prefer')).toHaveLength(1);
  });

  it('proposes review when no approach wins for a task type', () => {
    const p = analyzeEvolution([
      row('refactor', 'attempt_a', 1, 4),
      row('refactor', 'attempt_b', 2, 4),
    ]);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ kind: 'review', taskType: 'refactor' });
    // attempts is the cumulative total across approaches.
    expect(p[0]!.attempts).toBe(11);
    expect(p[0]!.rationale).toContain('attention');
  });

  it('handles the direct-answer pseudo-approach', () => {
    const p = analyzeEvolution([row('explain', '(réponse directe)', 6, 0)]);
    expect(p[0]).toMatchObject({ kind: 'prefer', approach: '(réponse directe)' });
  });

  it('produces stable, task-type-sorted output across multiple types', () => {
    const p = analyzeEvolution([
      row('git', 'git_commit', 4, 0),
      row('debug', 'trace>fix', 3, 1),
    ]);
    expect(p.map(x => x.taskType)).toEqual(['debug', 'git']);
  });

  it('respects custom thresholds', () => {
    // With a stricter goodRate, an 80% approach no longer counts as a winner.
    const rows = [row('tests', 'x', 4, 1)]; // 80%
    expect(analyzeEvolution(rows, { goodRate: 0.9 })[0]!.kind).toBe('review');
    expect(analyzeEvolution(rows, { goodRate: 0.7 })[0]!.kind).toBe('prefer');
  });
});
