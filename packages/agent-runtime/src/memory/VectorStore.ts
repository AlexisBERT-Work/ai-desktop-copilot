import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { bm25Scores } from './bm25';
import { createLogger } from '../logger';

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

/** Tout objet capable de produire un embedding (ex. OllamaClient). */
export interface Embedder {
  embed(text: string): Promise<number[]>;
}

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
  private embeddingsDisabled = false;

  constructor(private embedder?: Embedder, dataDir?: string) {
    const dir = dataDir ?? process.env['CATDESK_DATA_DIR'] ?? join(process.cwd(), 'data');
    mkdirSync(dir, { recursive: true });
    this.filePath = join(dir, 'vectors.json');
  }

  async initialize(): Promise<void> {
    if (existsSync(this.filePath)) {
      try {
        const raw = readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw) as StoredVector[];
        if (Array.isArray(parsed)) this.vectors = parsed;
      } catch (err) {
        log.warn('Could not load vectors file — starting empty', { error: String(err) });
        this.vectors = [];
      }
    }
    this.initialized = true;
    log.info('VectorStore initialized', { path: this.filePath, count: this.vectors.length, embedder: !!this.embedder });
  }

  async search(query: string, options: SearchOptions = {}): Promise<VectorSearchResult[]> {
    if (!this.initialized || this.vectors.length === 0) return [];

    const limit = options.limit ?? 5;
    const minScore = options.minScore ?? 0.6;

    const candidates = options.filter
      ? this.vectors.filter(v => matchesFilter(v.metadata, options.filter!))
      : this.vectors;
    if (candidates.length === 0) return [];

    const queryEmbedding = await this.tryEmbed(query);
    const denseOk = !!queryEmbedding && candidates.some(v => v.embedding.length === queryEmbedding.length);

    // Sparse signal: real BM25 (good at exact keywords / identifiers), normalized.
    const bm25 = bm25Scores(query, candidates.map(v => ({ id: v.id, content: v.content })));
    const maxBm = Math.max(0, ...bm25.values());

    // Hybrid fusion via a soft-OR: a strong single signal stays high (so existing
    // cosine thresholds keep working) while agreement between dense and sparse
    // boosts the score. dense defaults to 0 when embeddings are unavailable.
    const scored: VectorSearchResult[] = candidates.map(v => {
      const dense = denseOk && v.embedding.length === queryEmbedding!.length
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
    const embedding = (await this.tryEmbed(content)) ?? [];

    this.vectors.push({
      id,
      content,
      embedding,
      ...(metadata ? { metadata } : {}),
      createdAt: Date.now(),
    });
    this.persist();
    log.debug('Stored vector', { id, embedded: embedding.length > 0, total: this.vectors.length });
    return id;
  }

  async delete(id: string): Promise<void> {
    const before = this.vectors.length;
    this.vectors = this.vectors.filter(v => v.id !== id);
    if (this.vectors.length !== before) this.persist();
  }

  /** Embedding tolérant : null si pas d'embedder ou si Ollama échoue. */
  private async tryEmbed(text: string): Promise<number[] | null> {
    if (!this.embedder || this.embeddingsDisabled) return null;
    try {
      const vec = await this.embedder.embed(text);
      return Array.isArray(vec) && vec.length > 0 ? vec : null;
    } catch (err) {
      // Une seule alerte, puis repli silencieux sur les mots-clés.
      if (!this.embeddingsDisabled) {
        log.warn('Embeddings indisponibles — repli mots-clés', { error: String(err) });
        this.embeddingsDisabled = true;
      }
      return null;
    }
  }

  private persist(): void {
    try {
      writeFileSync(this.filePath, JSON.stringify(this.vectors), 'utf-8');
    } catch (err) {
      log.warn('Could not persist vectors', { error: String(err) });
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function matchesFilter(metadata: Record<string, unknown> | undefined, filter: Record<string, unknown>): boolean {
  if (!metadata) return false;
  return Object.entries(filter).every(([k, v]) => metadata[k] === v);
}
