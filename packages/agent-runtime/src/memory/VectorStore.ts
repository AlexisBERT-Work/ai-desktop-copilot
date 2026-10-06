import { bm25Scores } from './bm25';
import { cosineSimilarity, TolerantEmbedder, type Embedder } from './embedding';
import { createLogger } from '../logger';
import { dataPath } from '../lib/dataDir';
import { readJsonFile, writeJsonFile } from '../lib/persistence';

const log = createLogger('memory:vector');

export interface VectorSearchResult {
  id: string;
  content: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export interface SearchOptions {
  limit?: number;
  minScore?: number;
  filter?: Record<string, unknown>;
}

export type { Embedder } from './embedding';

/**
 * Plafond des échanges indexés automatiquement (`kind: 'exchange'`, un par
 * réponse). Chaque entrée porte un vecteur de ~768 flottants, et le fichier
 * entier est relu et réécrit : sans plafond il grossissait sans fin. Les
 * souvenirs posés explicitement (store_memory) ne sont jamais évincés.
 */
const MAX_EXCHANGES = 2_000;

interface StoredVector {
  id: string;
  content: string;
  embedding: number[];
  metadata?: Record<string, unknown>;
  createdAt: number;
}

/**
 * Mémoire vectorielle locale, persistée sur disque (JSON).
 *
 * - Embeddings calculés via Ollama (nomic-embed-text) quand disponible.
 * - Recherche par similarité cosinus en mémoire (suffisant pour un usage local ;
 *   pas de binding natif type LanceDB requis).
 * - Repli mots-clés si les embeddings sont indisponibles, pour rester utile.
 */
export class VectorStore {
  private initialized = false;
  private vectors: StoredVector[] = [];
  private readonly filePath: string;
  private readonly embedder: TolerantEmbedder;

  constructor(embedder?: Embedder, dataDir?: string) {
    this.filePath = dataPath('vectors.json', dataDir);
    this.embedder = new TolerantEmbedder(embedder, log);
  }

  async initialize(): Promise<void> {
    const parsed = readJsonFile(this.filePath, log);
    if (Array.isArray(parsed)) this.vectors = parsed as StoredVector[];
    this.initialized = true;
    log.info('VectorStore initialized', {
      path: this.filePath,
      count: this.vectors.length,
      embedder: this.embedder.configured,
    });
  }

  async search(query: string, options: SearchOptions = {}): Promise<VectorSearchResult[]> {
    if (!this.initialized || this.vectors.length === 0) return [];

    const limit = options.limit ?? 5;
    const minScore = options.minScore ?? 0.6;

    const candidates = options.filter
      ? this.vectors.filter(v => matchesFilter(v.metadata, options.filter!))
      : this.vectors;
    if (candidates.length === 0) return [];

    const queryEmbedding = await this.embedder.tryEmbed(query);
    const denseOk =
      !!queryEmbedding && candidates.some(v => v.embedding.length === queryEmbedding.length);

    // Sparse signal: real BM25 (good at exact keywords / identifiers), normalized.
    const bm25 = bm25Scores(
      query,
      candidates.map(v => ({ id: v.id, content: v.content })),
    );
    const maxBm = Math.max(0, ...bm25.values());

    // Hybrid fusion via a soft-OR: a strong single signal stays high (so existing
    // cosine thresholds keep working) while agreement between dense and sparse
    // boosts the score. dense defaults to 0 when embeddings are unavailable.
    const scored: VectorSearchResult[] = candidates.map(v => {
      const dense =
        denseOk && v.embedding.length === queryEmbedding!.length
          ? Math.max(0, cosineSimilarity(queryEmbedding!, v.embedding))
          : 0;
      const sparse = maxBm > 0 ? (bm25.get(v.id) ?? 0) / maxBm : 0;
      const score = 1 - (1 - dense) * (1 - sparse);
      return {
        id: v.id,
        content: v.content,
        score,
        ...(v.metadata ? { metadata: v.metadata } : {}),
      };
    });

    return scored
      .filter(r => r.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  async store(content: string, metadata?: Record<string, unknown>): Promise<string> {
    const id = crypto.randomUUID();
    const embedding = (await this.embedder.tryEmbed(content)) ?? [];

    this.vectors.push({
      id,
      content,
      embedding,
      ...(metadata ? { metadata } : {}),
      createdAt: Date.now(),
    });
    this.evictOldExchanges();
    this.persist();
    log.debug('Stored vector', { id, embedded: embedding.length > 0, total: this.vectors.length });
    return id;
  }

  async delete(id: string): Promise<void> {
    const before = this.vectors.length;
    this.vectors = this.vectors.filter(v => v.id !== id);
    if (this.vectors.length !== before) this.persist();
  }

  /** Évince les échanges automatiques les plus anciens au-delà de MAX_EXCHANGES. */
  private evictOldExchanges(): void {
    const exchanges = this.vectors.filter(v => v.metadata?.['kind'] === 'exchange');
    const excess = exchanges.length - MAX_EXCHANGES;
    if (excess <= 0) return;
    const evicted = new Set(
      [...exchanges]
        .sort((a, b) => a.createdAt - b.createdAt)
        .slice(0, excess)
        .map(v => v.id),
    );
    this.vectors = this.vectors.filter(v => !evicted.has(v.id));
  }

  private persist(): void {
    writeJsonFile(this.filePath, this.vectors, log);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────

function matchesFilter(
  metadata: Record<string, unknown> | undefined,
  filter: Record<string, unknown>,
): boolean {
  if (!metadata) return false;
  return Object.entries(filter).every(([k, v]) => metadata[k] === v);
}
