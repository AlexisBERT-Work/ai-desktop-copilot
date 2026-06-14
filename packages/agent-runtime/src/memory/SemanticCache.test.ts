import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SemanticCache } from './SemanticCache';

// Tiny deterministic "embedder": a bag-of-words vector over a fixed vocabulary.
// Paraphrases that share keywords land close in cosine space; unrelated text doesn't.
const VOCAB = ['port', 'postgres', 'serveur', 'base', 'capitale', 'france', 'tarte', 'pomme'];
const fakeEmbedder = {
  embed: async (text: string): Promise<number[]> => {
    const t = text.toLowerCase();
    return VOCAB.map(w => (t.includes(w) ? 1 : 0));
  },
};

describe('SemanticCache', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'semcache-test-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns null on an empty cache', async () => {
    const c = new SemanticCache(fakeEmbedder, { dataDir: dir });
    c.initialize();
    expect(await c.lookup('quoi que ce soit')).toBeNull();
  });

  it('hits on a semantically-equivalent (paraphrased) query', async () => {
    const c = new SemanticCache(fakeEmbedder, { dataDir: dir, threshold: 0.9 });
    c.initialize();
    await c.put('Quel est le port du serveur Postgres ?', 'Le port Postgres est 5544.');

    const hit = await c.lookup('donne-moi le port du postgres sur le serveur');
    expect(hit).not.toBeNull();
    expect(hit!.answer).toContain('5544');
    expect(hit!.exact).toBe(false);
    expect(hit!.similarity).toBeGreaterThanOrEqual(0.9);
  });

  it('misses on an unrelated query', async () => {
    const c = new SemanticCache(fakeEmbedder, { dataDir: dir, threshold: 0.9 });
    c.initialize();
    await c.put('Quel est le port du serveur Postgres ?', 'Le port Postgres est 5544.');
    expect(await c.lookup('Quelle est la capitale de la France ?')).toBeNull();
  });

  it('respects the similarity threshold', async () => {
    const c = new SemanticCache(fakeEmbedder, { dataDir: dir, threshold: 0.99 });
    c.initialize();
    await c.put('port du serveur postgres', 'réponse: 5544 sur le serveur');
    // Shares "port"/"postgres" but not "serveur" → cosine < 0.99.
    expect(await c.lookup('le port de postgres')).toBeNull();
  });

  it('expires entries past their TTL', async () => {
    const c = new SemanticCache(fakeEmbedder, { dataDir: dir, threshold: 0.9, ttlMs: -1 });
    // ttlMs<=0 disables expiry; use a tiny positive TTL via a second instance instead.
    c.initialize();
    await c.put('port du serveur postgres', 'Le port Postgres est 5544.');
    expect((await c.lookup('port du serveur postgres'))!.answer).toContain('5544');

    const expiring = new SemanticCache(fakeEmbedder, { dataDir: dir, threshold: 0.9, ttlMs: 1 });
    expiring.initialize();
    await new Promise(r => setTimeout(r, 5));
    expect(await expiring.lookup('port du serveur postgres')).toBeNull();
    expect(expiring.size()).toBe(0);
  });

  it('falls back to exact-text match when embeddings are unavailable', async () => {
    const noEmbed = new SemanticCache(undefined, { dataDir: dir });
    noEmbed.initialize();
    await noEmbed.put('Quelle heure est-il chez moi ?', 'Il est 14h00 précises.');

    const exact = await noEmbed.lookup('  quelle heure est-il chez moi ?  ');
    expect(exact).not.toBeNull();
    expect(exact!.exact).toBe(true);
    expect(exact!.answer).toBe('Il est 14h00 précises.');
    // A paraphrase must NOT hit without embeddings.
    expect(await noEmbed.lookup('donne-moi l’heure')).toBeNull();
  });

  it('does not cache trivially short queries or answers', async () => {
    const c = new SemanticCache(fakeEmbedder, { dataDir: dir });
    c.initialize();
    await c.put('hi', 'short answer that is long enough'); // query too short
    await c.put('a long enough query here', 'ok'); // answer too short
    expect(c.size()).toBe(0);
  });

  it('evicts the oldest entries past maxEntries', async () => {
    const c = new SemanticCache(fakeEmbedder, { dataDir: dir, maxEntries: 2 });
    c.initialize();
    await c.put('première question postgres', 'réponse une assez longue');
    await c.put('deuxième question capitale', 'réponse deux assez longue');
    await c.put('troisième question tarte', 'réponse trois assez longue');
    expect(c.size()).toBe(2);
  });

  it('persists across instances', async () => {
    const c1 = new SemanticCache(fakeEmbedder, { dataDir: dir, threshold: 0.9 });
    c1.initialize();
    await c1.put('Quel est le port du serveur Postgres ?', 'Le port Postgres est 5544.');
    expect(existsSync(join(dir, 'semantic-cache.json'))).toBe(true);

    const c2 = new SemanticCache(fakeEmbedder, { dataDir: dir, threshold: 0.9 });
    c2.initialize();
    const hit = await c2.lookup('le port du serveur postgres');
    expect(hit!.answer).toContain('5544');
  });
});
