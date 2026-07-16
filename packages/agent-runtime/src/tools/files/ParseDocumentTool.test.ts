import { describe, it, expect } from 'vitest';
import { detectFormat, ParseDocumentTool } from './ParseDocumentTool';

describe('detectFormat', () => {
  it('reconnaît pdf/docx/csv quelle que soit la casse', () => {
    expect(detectFormat('/home/alex/rapport.pdf')).toBe('pdf');
    expect(detectFormat('C:\\docs\\Lettre.DOCX')).toBe('docx');
    expect(detectFormat('data.CSV')).toBe('csv');
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
    expect(r.success).toBe(false);
    expect(r.error).toContain('.pdf');
  });
});
