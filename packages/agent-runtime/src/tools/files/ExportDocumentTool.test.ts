import { describe, it, expect } from 'vitest';
import { resolveExportFormat, ExportDocumentTool } from './ExportDocumentTool';

describe('resolveExportFormat', () => {
  it('déduit le format depuis l\'extension', () => {
    expect(resolveExportFormat('/out/rapport.pdf')).toBe('pdf');
    expect(resolveExportFormat('C:\\x\\Lettre.DOCX')).toBe('docx');
    expect(resolveExportFormat('page.html')).toBe('html');
    expect(resolveExportFormat('notes.md')).toBe('md');
    expect(resolveExportFormat('notes.txt')).toBe('md');
  });

  it('privilégie le format explicite', () => {
    expect(resolveExportFormat('whatever.bin', 'pdf')).toBe('pdf');
  });

  it('renvoie null si indéterminable', () => {
    expect(resolveExportFormat('archive.zip')).toBeNull();
    expect(resolveExportFormat('sansext')).toBeNull();
  });
});

describe('ExportDocumentTool', () => {
  const tool = new ExportDocumentTool();

  it('écrit un fichier → medium + confirmation', () => {
    expect(tool.riskLevel).toBe('medium');
    expect(tool.requiresConfirmation).toBe(true);
  });

  it('rejette content vide', async () => {
    expect((await tool.execute({ content: '', path: 'a.pdf' })).success).toBe(false);
  });

  it('rejette path vide', async () => {
    expect((await tool.execute({ content: 'x', path: '  ' })).success).toBe(false);
  });

  it('rejette un format indéterminable avant le sidecar', async () => {
    const r = await tool.execute({ content: 'x', path: 'archive.zip' });
    expect(r.success).toBe(false);
    expect(r.error).toContain('Format');
  });
});
