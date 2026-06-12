import { describe, it, expect } from 'vitest';
import { detectSpiral, normalizeSignature, type ActivityEvent } from './DetectSpiralTool';
import { commitsToBullets } from './GenerateStandupTool';
import type { Commit } from '../git/SummarizeGitLogTool';

describe('normalizeSignature', () => {
  it('collapse adresses, lignes et nombres', () => {
    expect(normalizeSignature('Error at file.ts:10:5 ptr 0xABCD')).toBe(normalizeSignature('Error at file.ts:88:2 ptr 0x1234'));
  });
});

function evt(minutesAgoStart: number, signature: string, kind?: string): ActivityEvent {
  return { at: new Date(Date.now() - minutesAgoStart * 60000).toISOString(), signature, ...(kind ? { kind } : {}) };
}

describe('detectSpiral', () => {
  it('ne conclut pas avec trop peu d\'événements', () => {
    expect(detectSpiral([evt(10, 'a'), evt(5, 'b')], 45).spiraling).toBe(false);
  });

  it('détecte une boucle longue sur la même signature avec échecs', () => {
    const events: ActivityEvent[] = [
      evt(60, 'TypeError in auth.ts', 'error'),
      evt(50, 'TypeError in auth.ts', 'test_fail'),
      evt(35, 'TypeError in auth.ts', 'test_fail'),
      evt(15, 'TypeError in auth.ts', 'error'),
      evt(2, 'TypeError in auth.ts', 'test_fail'),
    ];
    const v = detectSpiral(events, 45);
    expect(v.spiraling).toBe(true);
    expect(v.failureCount).toBeGreaterThanOrEqual(3);
    expect(v.suggestion).toMatch(/pause|erreur/i);
  });

  it('ne déclenche pas si le temps est sous le seuil', () => {
    const events: ActivityEvent[] = [evt(20, 'x'), evt(15, 'x'), evt(10, 'x'), evt(5, 'x')];
    expect(detectSpiral(events, 45).spiraling).toBe(false);
  });

  it('ne déclenche pas sur activité variée', () => {
    const events: ActivityEvent[] = [evt(60, 'a'), evt(45, 'b'), evt(30, 'c'), evt(10, 'd')];
    expect(detectSpiral(events, 45).spiraling).toBe(false);
  });
});

describe('commitsToBullets', () => {
  const mk = (subject: string, scope: string | null = null): Commit => ({
    hash: 'h', author: 'a', date: 'd', subject, type: 'feat', scope,
  });

  it('retire le préfixe conventional, déduplique et ignore les merges', () => {
    const bullets = commitsToBullets([
      mk('feat(web): add button', 'web'),
      mk('feat(web): add button', 'web'), // dup
      mk('Merge branch main'),
      mk('fix: crash on start'),
    ]);
    expect(bullets).toEqual(['[web] add button', 'crash on start']);
  });
});
