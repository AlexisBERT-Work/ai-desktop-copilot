import { describe, it, expect } from 'vitest';
import { isSupportedDataFile, validateAnalyzeArgs, AnalyzeDataTool } from './AnalyzeDataTool';

describe('isSupportedDataFile', () => {
  it('accepte csv et excel quelle que soit la casse', () => {
    expect(isSupportedDataFile('/data/ventes.csv')).toBe(true);
    expect(isSupportedDataFile('C:\\x\\Budget.XLSX')).toBe(true);
    expect(isSupportedDataFile('old.xls')).toBe(true);
  });

  it('refuse les autres formats', () => {
    expect(isSupportedDataFile('notes.txt')).toBe(false);
    expect(isSupportedDataFile('image.png')).toBe(false);
    expect(isSupportedDataFile('sansext')).toBe(false);
  });
});

describe('validateAnalyzeArgs', () => {
  it('rejette path vide et format non supporté', () => {
    expect(validateAnalyzeArgs({ path: '  ' }).ok).toBe(false);
    expect(validateAnalyzeArgs({ path: 'a.txt' }).ok).toBe(false);
  });

  it('accepte un profile minimal', () => {
    expect(validateAnalyzeArgs({ path: 'a.csv' }).ok).toBe(true);
  });

  it('aggregate exige group_by', () => {
    const r = validateAnalyzeArgs({ path: 'a.csv', operation: 'aggregate' });
    expect(r.ok).toBe(false);
  });

  it('aggregate exige value_column sauf si agg=count', () => {
    expect(validateAnalyzeArgs({ path: 'a.csv', operation: 'aggregate', group_by: ['cat'] }).ok).toBe(false);
    expect(validateAnalyzeArgs({ path: 'a.csv', operation: 'aggregate', group_by: ['cat'], agg: 'count' }).ok).toBe(true);
    expect(validateAnalyzeArgs({ path: 'a.csv', operation: 'aggregate', group_by: ['cat'], value_column: 'amount', agg: 'sum' }).ok).toBe(true);
  });

  it('rejette une operation inconnue', () => {
    // @ts-expect-error operation hors enum
    expect(validateAnalyzeArgs({ path: 'a.csv', operation: 'pivot' }).ok).toBe(false);
  });
});

describe('AnalyzeDataTool', () => {
  const tool = new AnalyzeDataTool();

  it('est à faible risque et sans confirmation', () => {
    expect(tool.riskLevel).toBe('low');
    expect(tool.requiresConfirmation).toBe(false);
  });

  it('échoue proprement sur des args invalides avant le sidecar', async () => {
    const r = await tool.execute({ path: 'a.csv', operation: 'aggregate' });
    expect(r.success).toBe(false);
  });
});
