import { describe, it, expect } from 'vitest';
import { parseConflicts } from './ResolveConflictsTool';

describe('parseConflicts', () => {
  it('parse un conflit simple ours/theirs', () => {
    const content = [
      'const a = 1;',
      '<<<<<<< HEAD',
      'const b = 2;',
      '=======',
      'const b = 3;',
      '>>>>>>> feature',
      'const c = 4;',
    ].join('\n');
    const hunks = parseConflicts(content);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]).toMatchObject({
      startLine: 2,
      oursLabel: 'HEAD',
      theirsLabel: 'feature',
      ours: 'const b = 2;',
      theirs: 'const b = 3;',
      base: null,
    });
  });

  it('parse un conflit diff3 avec base', () => {
    const content = [
      '<<<<<<< ours',
      'x = 1',
      '||||||| base',
      'x = 0',
      '=======',
      'x = 2',
      '>>>>>>> theirs',
    ].join('\n');
    const hunks = parseConflicts(content);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]?.base).toBe('x = 0');
    expect(hunks[0]?.ours).toBe('x = 1');
    expect(hunks[0]?.theirs).toBe('x = 2');
  });

  it('parse plusieurs conflits dans un fichier', () => {
    const content = [
      '<<<<<<< HEAD',
      'a',
      '=======',
      'b',
      '>>>>>>> x',
      'middle',
      '<<<<<<< HEAD',
      'c',
      '=======',
      'd',
      '>>>>>>> x',
    ].join('\n');
    expect(parseConflicts(content)).toHaveLength(2);
  });

  it('ignore un marqueur d\'ouverture non fermé', () => {
    const content = ['<<<<<<< HEAD', 'a', '======='].join('\n');
    expect(parseConflicts(content)).toHaveLength(0);
  });

  it('retourne vide sans conflit', () => {
    expect(parseConflicts('just some\ncode\n')).toHaveLength(0);
  });
});
