import { describe, it, expect } from 'vitest';
import { scanDiff } from './ReviewDiffTool';

function rules(diff: string): string[] {
  return scanDiff(diff).findings.map((f) => f.rule);
}

describe('scanDiff', () => {
  it('compte les lignes ajoutées/supprimées et les fichiers', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      'index 111..222 100644',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,2 +1,3 @@',
      ' const x = 1;',
      '-const y = 2;',
      '+const y = 3;',
      '+const z = 4;',
    ].join('\n');
    const r = scanDiff(diff);
    expect(r.filesChanged).toEqual(['src/a.ts']);
    expect(r.added).toBe(2);
    expect(r.removed).toBe(1);
  });

  it('calcule le bon numéro de ligne dans le nouveau fichier', () => {
    const diff = [
      '--- a/f.ts',
      '+++ b/f.ts',
      '@@ -10,3 +10,4 @@',
      ' line10',
      ' line11',
      '+console.log("here");',
      ' line13',
    ].join('\n');
    const f = scanDiff(diff).findings;
    expect(f).toHaveLength(1);
    expect(f[0]?.rule).toBe('console-log');
    expect(f[0]?.line).toBe(12); // 10, 11, then the added line is 12
  });

  it('détecte un secret codé en dur (critical)', () => {
    const diff = ['+++ b/cfg.ts', '@@ -0,0 +1 @@', '+const apiKey = "abcdef1234567890";'].join('\n');
    const f = scanDiff(diff).findings;
    expect(f[0]?.rule).toBe('secret');
    expect(f[0]?.severity).toBe('critical');
  });

  it('détecte une clé AWS et une clé privée', () => {
    const diff = [
      '+++ b/s.ts',
      '@@ -0,0 +2 @@',
      '+const k = "AKIAIOSFODNN7EXAMPLE";',
      '+const pem = "-----BEGIN RSA PRIVATE KEY-----";',
    ].join('\n');
    expect(rules(diff)).toEqual(expect.arrayContaining(['aws-key', 'private-key']));
  });

  it('détecte les marqueurs de conflit', () => {
    const diff = ['+++ b/m.ts', '@@ -0,0 +1 @@', '+<<<<<<< HEAD'].join('\n');
    expect(rules(diff)).toContain('conflict-marker');
  });

  it('détecte debugger, eval, test.only, any, TODO', () => {
    const diff = [
      '+++ b/x.ts',
      '@@ -0,0 +5 @@',
      '+debugger;',
      '+const r = eval(code);',
      '+it.only("x", () => {});',
      '+let v: any = 1;',
      '+// TODO: fix later',
    ].join('\n');
    expect(rules(diff)).toEqual(
      expect.arrayContaining(['debugger', 'eval', 'test-only', 'ts-any', 'todo']),
    );
  });

  it('ignore les lignes supprimées et de contexte', () => {
    const diff = [
      '+++ b/x.ts',
      '@@ -1,3 +1,2 @@',
      ' const a = eval(1);', // context, not flagged
      '-debugger;', // removed, not flagged
      ' const b = 2;',
    ].join('\n');
    expect(scanDiff(diff).findings).toHaveLength(0);
  });
});
