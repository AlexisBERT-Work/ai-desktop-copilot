import { describe, it, expect } from 'vitest';
import { WriteClipboardTool } from './WriteClipboardTool';

// Tests de validation uniquement : on n'écrase pas le presse-papier réel
// de la machine qui exécute la suite.
describe('WriteClipboardTool — validation', () => {
  const tool = new WriteClipboardTool();

  it('refuse un content absent ou vide', async () => {
    expect((await tool.run({})).success).toBe(false);
    expect((await tool.run({ content: '' })).success).toBe(false);
    expect((await tool.run({ content: 42 })).success).toBe(false);
  });

  it('refuse un contenu trop grand', async () => {
    const res = await tool.run({ content: 'a'.repeat(1_000_001) });
    expect(res.success).toBe(false);
    expect(res.error).toContain('trop grand');
  });
});
