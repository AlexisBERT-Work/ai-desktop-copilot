import { describe, it, expect } from 'vitest';
import { detectFormat, ParseDocumentTool } from './ParseDocumentTool';
import { expectFail } from '../base/testResult';

describe('detectFormat', () => {
  it('reconnaît pdf/docx/csv quelle que soit la casse', () => {
    expect(detectFormat('/home/alex/rapport.pdf')).toBe('pdf');
    expect(detectFormat('C:\\docs\\Lettre.DOCX')).toBe('docx');
    expect(detectFormat('data.CSV')).toBe('csv');
  });

  it('reconnaît PowerPoint, Excel et OpenDocument (Plan E)', () => {
    expect(detectFormat('C:\\docs\\Bilan.PPTX')).toBe('pptx');
    expect(detectFormat('budget.xlsx')).toBe('xlsx');
    expect(detectFormat('macros.xlsm')).toBe('xlsx');
    expect(detectFormat('lettre.odt')).toBe('odf');
    expect(detectFormat('ventes.ods')).toBe('odf');
    expect(detectFormat('kickoff.odp')).toBe('odf');
    expect(detectFormat('ancien.ppt')).toBeNull();
  });

  it('renvoie null pour un format non supporté ou sans extension', () => {
    expect(detectFormat('image.png')).toBeNull();
    expect(detectFormat('notes.txt')).toBeNull();
    expect(detectFormat('sansext')).toBeNull();
  });
});

describe('ParseDocumentTool', () => {
  const tool = new ParseDocumentTool();

  it('est à faible risque et sans confirmation (lecture locale)', () => {
    expect(tool.riskLevel).toBe('low');
    expect(tool.requiresConfirmation).toBe(false);
  });

  it('rejette un path vide', async () => {
    expect((await tool.run({ path: '  ' })).success).toBe(false);
  });

  it('rejette un format non supporté avant tout appel au sidecar', async () => {
    const r = await tool.run({ path: 'photo.png' });
    expect(expectFail(r).error).toContain('.pdf');
  });
});
