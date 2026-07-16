import { describe, it, expect } from 'vitest';
import {
  detectLevel,
  extractTimestamp,
  normalizeLogLine,
  analyzeLogLines,
  AnalyzeLogsTool,
} from './AnalyzeLogsTool';

describe('detectLevel', () => {
  it('reconnaît les niveaux et normalise WARNING→WARN', () => {
    expect(detectLevel('2026-01-01 ERROR boom')).toBe('ERROR');
    expect(detectLevel('[warning] disk low')).toBe('WARN');
    expect(detectLevel('plain status line')).toBeNull();
  });
});

describe('extractTimestamp', () => {
  it('extrait un timestamp ISO', () => {
    expect(extractTimestamp('2026-06-27T23:10:01.123Z ERROR x')).toBe('2026-06-27T23:10:01.123Z');
    expect(extractTimestamp('2026-06-27 23:10:01 INFO x')).toBe('2026-06-27 23:10:01');
    expect(extractTimestamp('no timestamp here')).toBeNull();
  });
});

describe('normalizeLogLine', () => {
  it('collapse les variables (nombres, hex, uuid, strings, ts)', () => {
    const a = normalizeLogLine('2026-01-01T00:00:00Z ERROR user 42 failed "alice" 0xFF');
    const b = normalizeLogLine('2026-02-02T11:11:11Z ERROR user 99 failed "bob" 0x1A');
    expect(a).toBe(b);
  });
});

describe('analyzeLogLines', () => {
  const lines = [
    '2026-01-01T00:00:00Z INFO start',
    '2026-01-01T00:00:01Z ERROR connection to db 5432 failed',
    '2026-01-01T00:00:02Z WARN retrying',
    '2026-01-01T00:00:03Z ERROR connection to db 5433 failed',
    '2026-01-01T00:00:04Z FATAL out of memory',
    'plain line without level',
  ];

  it('compte les niveaux', () => {
    const r = analyzeLogLines(lines);
    expect(r.levelCounts['ERROR']).toBe(2);
    expect(r.levelCounts['WARN']).toBe(1);
    expect(r.levelCounts['INFO']).toBe(1);
    expect(r.levelCounts['FATAL']).toBe(1);
    expect(r.levelCounts['OTHER']).toBe(1);
  });

  it('regroupe les erreurs similaires', () => {
    const r = analyzeLogLines(lines);
    const dbGroup = r.topErrors.find(g => g.normalized.includes('connection to db'));
    expect(dbGroup?.count).toBe(2);
  });

  it('expose la plage temporelle et les erreurs récentes', () => {
    const r = analyzeLogLines(lines);
    expect(r.timeRange?.first).toBe('2026-01-01T00:00:00Z');
    expect(r.timeRange?.last).toBe('2026-01-01T00:00:04Z');
    expect(r.recentErrors.length).toBeGreaterThan(0);
    expect(r.linesAnalyzed).toBe(6);
  });
});

describe('AnalyzeLogsTool', () => {
  const tool = new AnalyzeLogsTool();

  it('lecture locale → low, sans confirmation', () => {
    expect(tool.riskLevel).toBe('low');
    expect(tool.requiresConfirmation).toBe(false);
  });

  it('rejette un path vide', async () => {
    expect((await tool.run({ path: '  ' })).success).toBe(false);
  });

  it('renvoie une erreur claire si le fichier est absent', async () => {
    const r = await tool.run({ path: 'C:/nope/does-not-exist.log' });
    expect(r.success).toBe(false);
    expect(r.error).toContain('introuvable');
  });
});
