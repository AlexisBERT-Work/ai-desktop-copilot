import { describe, it, expect } from 'vitest';
import { proposeSkills, renderSkillDraft } from './proposeSkills';
import type { StrategyRow } from './PlaybookStore';

function row(taskType: string, approach: string, successes: number, failures: number): StrategyRow {
  return { taskType, approach, successes, failures, updatedAt: 1 };
}

describe('proposeSkills', () => {
  it('drafts a skill for a strong, tool-based winner', () => {
    const drafts = proposeSkills([row('debug', 'analyze_stacktrace>read_file', 8, 1)]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ taskType: 'debug', slug: 'auto-debug' });
    expect(drafts[0]!.markdown).toContain('analyze_stacktrace');
    expect(drafts[0]!.markdown).toContain('read_file');
  });

  it('ignores approaches below the strength bar', () => {
    expect(proposeSkills([row('tests', 'a>b', 3, 2)])).toEqual([]); // 60% < 75%
  });

  it('ignores approaches with too few attempts', () => {
    expect(proposeSkills([row('tests', 'a>b', 3, 0)])).toEqual([]); // 3 < minAttempts 4
  });

  it('never drafts from a direct-answer approach (no reusable procedure)', () => {
    expect(proposeSkills([row('explain', '(réponse directe)', 10, 0)])).toEqual([]);
  });

  it('keeps only the best qualifying approach per task type', () => {
    const drafts = proposeSkills([
      row('git', 'git_commit', 4, 0),       // 100%
      row('git', 'review_diff>git_commit', 6, 2), // 75%
    ]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.approach).toBe('git_commit');
  });

  it('produces stable, task-type-sorted output', () => {
    const drafts = proposeSkills([
      row('tests', 'generate_unit_tests', 5, 0),
      row('debug', 'analyze_stacktrace', 5, 0),
    ]);
    expect(drafts.map(d => d.taskType)).toEqual(['debug', 'tests']);
  });

  it('respects custom thresholds', () => {
    const rows = [row('search', 'semantic_search', 7, 3)]; // 70%
    expect(proposeSkills(rows, { strongRate: 0.65 })).toHaveLength(1);
    expect(proposeSkills(rows, { strongRate: 0.8 })).toHaveLength(0);
  });
});

describe('renderSkillDraft', () => {
  it('renders valid frontmatter and numbered tool steps', () => {
    const md = renderSkillDraft({
      taskType: 'debug', approach: 'analyze_stacktrace>read_file',
      successRate: 0.875, attempts: 8, slug: 'auto-debug',
    });
    expect(md).toMatch(/^---\nname: auto-debug\n/);
    expect(md).toContain('status: draft');
    expect(md).toContain('1. `analyze_stacktrace`');
    expect(md).toContain('2. `read_file`');
    expect(md).toContain('88% de succès sur 8 essais'); // rounded
    expect(md).toContain('rien n\'est appliqué automatiquement');
  });
});
