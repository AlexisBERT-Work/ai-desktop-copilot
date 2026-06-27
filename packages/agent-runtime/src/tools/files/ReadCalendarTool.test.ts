import { describe, it, expect } from 'vitest';
import { buildCalendarParams, ReadCalendarTool } from './ReadCalendarTool';

describe('buildCalendarParams', () => {
  it('applique les défauts days=30 / limit=50', () => {
    expect(buildCalendarParams({ path: 'a.ics' })).toEqual({ path: 'a.ics', days: 30, limit: 50 });
  });

  it('respecte les valeurs fournies', () => {
    expect(buildCalendarParams({ path: 'a.ics', days: 7, limit: 10 })).toEqual({ path: 'a.ics', days: 7, limit: 10 });
  });

  it('inclut from/to seulement si présents', () => {
    expect(buildCalendarParams({ path: 'a.ics', from: '2026-01-01', to: '2026-01-31' })).toEqual({
      path: 'a.ics',
      days: 30,
      limit: 50,
      from: '2026-01-01',
      to: '2026-01-31',
    });
    expect('from' in buildCalendarParams({ path: 'a.ics' })).toBe(false);
  });
});

describe('ReadCalendarTool', () => {
  const tool = new ReadCalendarTool();

  it('est à faible risque, lecture locale sans confirmation', () => {
    expect(tool.riskLevel).toBe('low');
    expect(tool.requiresConfirmation).toBe(false);
  });

  it('rejette un path vide', async () => {
    expect((await tool.execute({ path: '  ' })).success).toBe(false);
  });
});
