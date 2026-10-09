// Outillage d'embeddings partagé par la mémoire vectorielle et le cache
// sémantique, qui en recopiaient chacun leur version.

import type { Logger } from '../logger';

/** Tout objet capable de produire un embedding (ex. OllamaClient). */
export interface Embedder {
  embed(text: string): Promise<number[]>;
}

/** Similarité cosinus ; 0 si l'un des vecteurs est nul. */
export function cosineSimilarity(a: number[], b: number[]): number {
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

const DEFAULT_COOLDOWN_MS = 60_000;

/**
 * Embedder tolérant : `null` au lieu d'une exception, et après un échec, une
 * pause (`cooldownMs`) avant de réessayer. Auparavant un seul échec coupait
 * les embeddings jusqu'au redémarrage — or le premier appel arrive souvent
 * au démarrage, avant qu'Ollama ne réponde : la recherche sémantique restait
 * alors en repli mots-clés pour toute la session.
 */
export class TolerantEmbedder {
  private suspendedUntil = 0;
  private warned = false;

  constructor(
    private readonly inner: Embedder | undefined,
    private readonly log: Logger,
    private readonly cooldownMs = DEFAULT_COOLDOWN_MS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get configured(): boolean {
    return this.inner !== undefined;
  }

  async tryEmbed(text: string): Promise<number[] | null> {
    if (!this.inner || this.now() < this.suspendedUntil) return null;
    try {
      const vec = await this.inner.embed(text);
      this.warned = false;
      return Array.isArray(vec) && vec.length > 0 ? vec : null;
    } catch (err) {
      this.suspendedUntil = this.now() + this.cooldownMs;
      // Une alerte par panne, pas une par appel.
      if (!this.warned) {
        this.warned = true;
        this.log.warn('Embeddings indisponibles — repli, nouvel essai plus tard', {
          error: String(err),
          retryInMs: this.cooldownMs,
        });
      }
      return null;
    }
  }
}
