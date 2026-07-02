import { describe, it, expect, vi } from 'vitest';
import { StoreMemoryTool } from './StoreMemoryTool';
import type { VectorStore } from '../../memory/VectorStore';

function makeStore() {
  return { store: vi.fn(async () => 'id-123') } as unknown as VectorStore & {
    store: ReturnType<typeof vi.fn>;
  };
}

describe('StoreMemoryTool', () => {
  it('refuse un content vide ou absent', async () => {
    const tool = new StoreMemoryTool(makeStore());
    expect((await tool.execute({})).success).toBe(false);
    expect((await tool.execute({ content: '   ' })).success).toBe(false);
  });

  it('refuse un content trop long', async () => {
    const tool = new StoreMemoryTool(makeStore());
    const res = await tool.execute({ content: 'a'.repeat(10_001) });
    expect(res.success).toBe(false);
    expect(res.error).toContain('trop long');
  });

  it('refuse des tags non-tableau', async () => {
    const tool = new StoreMemoryTool(makeStore());
    expect((await tool.execute({ content: 'x', tags: 'oops' })).success).toBe(false);
  });

  it('stocke avec métadonnées source + tags filtrés', async () => {
    const store = makeStore();
    const tool = new StoreMemoryTool(store);
    const res = await tool.execute({ content: '  fait important  ', tags: ['projet', '', 42] });
    expect(res.success).toBe(true);
    expect((res.data as { id: string }).id).toBe('id-123');
    expect(store.store).toHaveBeenCalledWith(
      'fait important',
      expect.objectContaining({ source: 'store_memory', tags: ['projet'] }),
    );
  });

  it('remonte les erreurs du VectorStore', async () => {
    const store = makeStore();
    store.store.mockRejectedValueOnce(new Error('disque plein'));
    const tool = new StoreMemoryTool(store);
    const res = await tool.execute({ content: 'x' });
    expect(res.success).toBe(false);
    expect(res.error).toContain('disque plein');
  });
});
