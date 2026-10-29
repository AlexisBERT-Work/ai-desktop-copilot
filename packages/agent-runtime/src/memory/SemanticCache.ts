import { cosineSimilarity, TolerantEmbedder, type Embedder } from './embedding';
import { createLogger } from '../logger';
import { dataPath } from '../lib/dataDir';
import { readJsonFile, writeJsonFile } from '../lib/persistence';

const log = createLogger('memory:semcache');

export interface CacheHit {
  answer: string;
  /** Cosine similarity of the matched query (1 for an exact-text fallback hit). */
  similarity: number;
  /** True when matched by normalized text (embeddings unavailable). */
  exact: boolean;
}

export interface SemanticCacheOptions {
  dataDir?: string;
  /** Minimum cosine similarity to count as a hit. High by design — a wrong
   *  cached answer is worse than a cache miss. Default 0.95. */
  threshold?: number;
  /** Entries older than this are ignored and pruned. 0 disables expiry. Default 24h. */
  ttlMs?: number;
  /** Cap on stored entries; oldest evicted past this. Default 200. */
  maxEntries?: number;
}

interface CacheEntry {
  id: string;
  query: string;
  /** Lowercased/trimmed query for the embeddings-unavailable fallback. */
  queryNorm: string;
  embedding: number[];
  answer: string;
  createdAt: number;
}

/**
 * Cache sémantique de réponses (CATDESK-CONCEPTS-AVANCES §E).
 *
 * Mémorise les réponses indexées par l'embedding de la requête, pas par texte
 * exact : deux formulations différentes d'une même question touchent le même
 * cache. Sur un hit, on rend la réponse sans appeler le LLM (gros gain de
 * latence, surtout sur le first-token lent en local). Seuil cosinus volontairement
 * élevé : un faux hit coûte plus cher qu'un miss.
 *
 * Sécurité d'emploi (côté orchestrateur) : ne mettre en cache que les réponses
 * produites SANS outil (une réponse issue d'outils reflète un état du monde
 * mutable), et ne consulter le cache que pour une requête autonome (sans
 * historique de conversation), sinon une réponse dépendante du contexte serait
 * resservie à tort.
 */
export class SemanticCache {
  private initialized = false;
  private entries: CacheEntry[] = [];
  private readonly filePath: string;
  private readonly threshold: number;
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly embedder: TolerantEmbedder;

  constructor(embedder?: Embedder, opts: SemanticCacheOptions = {}) {
    this.embedder = new TolerantEmbedder(embedder, log);
    this.filePath = dataPath('semantic-cache.json', opts.dataDir);
    this.threshold = opts.threshold ?? 0.95;
    this.ttlMs = opts.ttlMs ?? 24 * 60 * 60 * 1000;
    this.maxEntries = opts.maxEntries ?? 200;
  }

  initialize(): void {
    const parsed = readJsonFile(this.filePath, log);
    if (Array.isArray(parsed)) this.entries = parsed as CacheEntry[];
    this.initialized = true;
    log.info('SemanticCache initialized', {
      path: this.filePath,
      count: this.entries.length,
      embedder: this.embedder.configured,
    });
  }

  /** Look up a cached answer for a semantically-equivalent query, or null. */
  async lookup(query: string): Promise<CacheHit | null> {
    if (!this.initialized || this.entries.length === 0) return null;
    const q = query.trim();
    if (!q) return null;

    this.pruneExpired();
    if (this.entries.length === 0) return null;

    const queryEmbedding = await this.embedder.tryEmbed(q);
    if (queryEmbedding) {
      let best: CacheEntry | undefined;
      let bestSim = -Infinity;
      for (const e of this.entries) {
        if (e.embedding.length !== queryEmbedding.length) continue;
        const sim = cosineSimilarity(queryEmbedding, e.embedding);
        if (sim > bestSim) {
          bestSim = sim;
          best = e;
        }
      }
      if (best && bestSim >= this.threshold) {
        log.debug('Semantic cache hit', { similarity: Number(bestSim.toFixed(3)) });
        return { answer: best.answer, similarity: bestSim, exact: false };
      }
      return null;
    }

    // Embeddings unavailable → degrade to exact normalized-text match.
    const norm = q.toLowerCase();
    const hit = this.entries.find(e => e.queryNorm === norm);
    return hit ? { answer: hit.answer, similarity: 1, exact: true } : null;
  }

  /** Cache an answer for a query. No-op for trivially short answers. */
  async put(query: string, answer: string): Promise<void> {
    const q = query.trim();
    const a = answer.trim();
    if (q.length < 8 || a.length < 16) return; // not worth caching

    const norm = q.toLowerCase();
    const embedding = (await this.embedder.tryEmbed(q)) ?? [];

    // Replace an existing entry for the same exact query rather than duplicating.
    this.entries = this.entries.filter(e => e.queryNorm !== norm);
    this.entries.push({
      id: crypto.randomUUID(),
      query: q,
      queryNorm: norm,
      embedding,
      answer: a,
      createdAt: Date.now(),
    });

    // Evict oldest beyond the cap.
    if (this.entries.length > this.maxEntries) {
      this.entries.sort((x, y) => x.createdAt - y.createdAt);
      this.entries = this.entries.slice(this.entries.length - this.maxEntries);
    }
    this.persist();
    log.debug('Cached answer', { embedded: embedding.length > 0, total: this.entries.length });
  }

  /** Number of live (non-expired) entries — handy for diagnostics/tests. */
  size(): number {
    this.pruneExpired();
    return this.entries.length;
  }

  private pruneExpired(): void {
    if (this.ttlMs <= 0) return;
    const cutoff = Date.now() - this.ttlMs;
    const before = this.entries.length;
    this.entries = this.entries.filter(e => e.createdAt >= cutoff);
    if (this.entries.length !== before) this.persist();
  }

  private persist(): void {
    writeJsonFile(this.filePath, this.entries, log);
  }
}
