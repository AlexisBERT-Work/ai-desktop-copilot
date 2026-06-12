import { describe, it, expect } from 'vitest';
import { classifyCommit, parseLog } from './SummarizeGitLogTool';

describe('classifyCommit', () => {
  it('extrait type et scope des Conventional Commits', () => {
    expect(classifyCommit('feat(web): add browser tools')).toEqual({ type: 'feat', scope: 'web' });
    expect(classifyCommit('fix: route streamed tokens')).toEqual({ type: 'fix', scope: null });
    expect(classifyCommit('feat(agent)!: breaking change')).toEqual({ type: 'feat', scope: 'agent' });
  });

  it('range les sujets non conventionnels en "other"', () => {
    expect(classifyCommit('Merge branch main')).toEqual({ type: 'other', scope: null });
  });
});

describe('parseLog', () => {
  it('parse les lignes séparées par unit-separator', () => {
    const raw = [
      'abc123\x1fAlexis\x1f2026-06-10\x1ffeat(chat): add streaming',
      'def456\x1fBob\x1f2026-06-09\x1ffix(chat): wrap args',
    ].join('\n');
    const commits = parseLog(raw);
    expect(commits).toHaveLength(2);
    expect(commits[0]).toMatchObject({ hash: 'abc123', author: 'Alexis', type: 'feat', scope: 'chat' });
    expect(commits[1]).toMatchObject({ hash: 'def456', type: 'fix' });
  });

  it('ignore les lignes vides', () => {
    expect(parseLog('\n\n')).toHaveLength(0);
  });
});
