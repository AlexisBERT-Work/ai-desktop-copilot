import { describe, it, expect } from 'vitest';
import { inferCommitType, inferScope } from './GitCommitTool';

describe('inferCommitType', () => {
  it('détecte les tests', () => {
    expect(inferCommitType('+ added foo.test.ts', '')).toBe('test');
  });

  it('détecte la documentation', () => {
    expect(inferCommitType('+ update guide', 'docs/guide.md | 2')).toBe('docs');
  });

  it('détecte un refactor', () => {
    expect(inferCommitType('refactor: rename helper', 'src/a.ts | 4')).toBe('refactor');
  });

  it('détecte la performance', () => {
    expect(inferCommitType('improve performance, faster loop', 'src/a.ts | 4')).toBe('perf');
  });

  it('détecte le style', () => {
    expect(inferCommitType('run prettier formatting', 'src/a.ts | 4')).toBe('style');
  });

  it('détecte un fix', () => {
    expect(inferCommitType('+ fix the crash bug', 'src/a.ts | 2')).toBe('fix');
  });

  it('retombe sur feat par défaut', () => {
    expect(inferCommitType('+ add new endpoint', 'src/api.ts | 10')).toBe('feat');
  });

  it('priorise test sur fix (ordre des règles)', () => {
    expect(inferCommitType('+ fix bug in foo.test.ts', '')).toBe('test');
  });
});

describe('inferScope', () => {
  it('renvoie null sans fichier', () => {
    expect(inferScope([])).toBeNull();
  });

  it('renvoie le scope dominant (>50%)', () => {
    expect(inferScope([
      'packages/agent-runtime/src/a.ts',
      'packages/agent-runtime/src/b.ts',
    ])).toBe('agent-runtime');
  });

  it('gère apps/ et choisit la majorité', () => {
    expect(inferScope([
      'apps/desktop/a.rs',
      'apps/desktop/b.rs',
      'packages/foo/c.ts',
    ])).toBe('desktop');
  });

  it('renvoie null sans majorité claire (50/50)', () => {
    expect(inferScope([
      'packages/a/x.ts',
      'packages/b/y.ts',
    ])).toBeNull();
  });

  it('renvoie null pour des chemins sans préfixe reconnu', () => {
    expect(inferScope(['random.txt', 'LICENSE'])).toBeNull();
  });
});
