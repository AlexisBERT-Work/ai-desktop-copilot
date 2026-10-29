import { describe, expect, it, vi } from 'vitest';
import { cosineSimilarity, TolerantEmbedder } from './embedding';
import type { Logger } from '../logger';

const log: Logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

describe('cosineSimilarity', () => {
  it('vaut 1 pour des vecteurs colinéaires, 0 pour un vecteur nul', () => {
    expect(cosineSimilarity([1, 2], [2, 4])).toBeCloseTo(1);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});

describe('TolerantEmbedder', () => {
  it('sans embedder : null, sans appel', async () => {
    expect(await new TolerantEmbedder(undefined, log).tryEmbed('x')).toBeNull();
  });

  it('après un échec, se suspend PUIS réessaie (pas désactivé à vie)', async () => {
    let now = 0;
    let up = false;
    const embed = vi.fn(async () => {
      if (!up) throw new Error('Ollama pas encore prêt');
      return [0.1, 0.2];
    });
    const embedder = new TolerantEmbedder({ embed }, log, 1_000, () => now);

    expect(await embedder.tryEmbed('a')).toBeNull(); // démarrage : Ollama absent
    up = true;
    now = 500;
    expect(await embedder.tryEmbed('a')).toBeNull(); // encore suspendu
    expect(embed).toHaveBeenCalledTimes(1);

    now = 1_500;
    expect(await embedder.tryEmbed('a')).toEqual([0.1, 0.2]); // reprise
    expect(embed).toHaveBeenCalledTimes(2);
  });
});
