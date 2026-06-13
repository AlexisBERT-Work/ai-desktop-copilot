import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { VectorStore, type Embedder } from './VectorStore';

/**
 * Embedder factice et déterministe : projette le texte sur un sac de mots
 * d'un vocabulaire fixe. Deux textes partageant des mots auront une similarité
 * cosinus élevée — ce qui rend le classement sémantique prévisible et testable
 * sans dépendre d'Ollama.
 */
const VOCAB = ['pnpm', 'typescript', 'tauri', 'rust', 'tarte', 'pommes', 'recette', 'projet'];
const fakeEmbedder: Embedder = {
  async embed(text: string): Promise<number[]> {
    const lower = text.toLowerCase();
    return VOCAB.map(word => (lower.includes(word) ? 1 : 0));
  },
};

describe('VectorStore', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ndvec-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe('repli mots-clés (sans embedder)', () => {
    it('classe en tête le document partageant le plus de termes', async () => {
      const vs = new VectorStore(undefined, dir);
      await vs.initialize();
      await vs.store('L utilisateur prefere pnpm et typescript strict');
      await vs.store('La recette de la tarte aux pommes');

      const results = await vs.search('quel gestionnaire de paquets pnpm typescript', {
        limit: 5,
        minScore: 0.01,
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.content).toContain('pnpm');
    });

    it('renvoie un tableau vide quand le store est vide', async () => {
      const vs = new VectorStore(undefined, dir);
      await vs.initialize();
      expect(await vs.search('quoi que ce soit')).toEqual([]);
    });

    it('respecte minScore (aucun terme commun => écarté)', async () => {
      const vs = new VectorStore(undefined, dir);
      await vs.initialize();
      await vs.store('La recette de la tarte aux pommes');
      const results = await vs.search('kubernetes docker orchestration', { minScore: 0.5 });
      expect(results).toEqual([]);
    });
  });

  describe('recherche sémantique (embedder factice)', () => {
    it('classe par similarité cosinus', async () => {
      const vs = new VectorStore(fakeEmbedder, dir);
      await vs.initialize();
      await vs.store('projet tauri en rust');
      await vs.store('tarte aux pommes recette');

      const results = await vs.search('tauri rust projet', { limit: 2, minScore: 0.1 });
      expect(results[0]?.content).toContain('tauri');
      expect(results[0]!.score).toBeGreaterThan(results[1]?.score ?? 0);
    });
  });

  describe('persistance', () => {
    it('écrit un fichier et recharge les vecteurs', async () => {
      const vs = new VectorStore(undefined, dir);
      await vs.initialize();
      await vs.store('projet catdesk tauri', { tags: ['projet'] });
      expect(existsSync(join(dir, 'vectors.json'))).toBe(true);

      const reloaded = new VectorStore(undefined, dir);
      await reloaded.initialize();
      const results = await reloaded.search('tauri', { minScore: 0.01 });
      expect(results.map(r => r.content)).toContain('projet catdesk tauri');
    });
  });

  describe('delete', () => {
    it('supprime un vecteur par id', async () => {
      const vs = new VectorStore(undefined, dir);
      await vs.initialize();
      const id = await vs.store('a supprimer pnpm');
      await vs.store('a garder tauri');

      await vs.delete(id);
      const results = await vs.search('pnpm tauri', { minScore: 0.01 });
      expect(results.some(r => r.content.includes('a supprimer'))).toBe(false);
    });
  });

  describe('filter', () => {
    it('ne retient que les métadonnées correspondantes', async () => {
      const vs = new VectorStore(undefined, dir);
      await vs.initialize();
      await vs.store('note pnpm projet', { kind: 'pref' });
      await vs.store('note tauri projet', { kind: 'projet' });

      const results = await vs.search('projet', { minScore: 0.01, filter: { kind: 'pref' } });
      expect(results.length).toBe(1);
      expect(results[0]?.metadata?.['kind']).toBe('pref');
    });
  });
});
