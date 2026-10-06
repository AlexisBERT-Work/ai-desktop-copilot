import type { WarmMemoryStore } from './WarmMemoryStore';
import { createLogger } from '../logger';

const log = createLogger('memory:consolidator');

export interface MemoryConsolidatorOptions {
  /** How often the maintenance pass runs. Default 6h. */
  intervalMs?: number;
  /** Facts not refreshed for longer than this become prune candidates. Default 30d. */
  maxAgeMs?: number;
  /** Below this confidence, a stale fact is pruned. High-confidence facts persist. Default 0.5. */
  minConfidence?: number;
  /**
   * Délai du premier passage après start(). Default 2 min. Sans lui, le premier
   * passage n'avait lieu qu'au bout de `intervalMs` (6 h) : une app lancée
   * le matin et fermée le soir ne consolidait jamais.
   */
  initialDelayMs?: number;
}

/**
 * Background consolidation of the warm memory (CATDESK-CONCEPTS-AVANCES §3):
 * periodically tidies the fact store — merges cross-subject duplicates and
 * prunes stale, low-confidence facts — so the set the model sees stays small
 * and coherent over time.
 *
 * Deterministic and cheap (no LLM, no GPU), so it can run on a plain interval
 * without disturbing the user. A semantic (LLM-driven) merge of paraphrased
 * facts is a deliberate future step, not done here.
 */
export class MemoryConsolidator {
  private timer: ReturnType<typeof setInterval> | undefined;
  private firstRun: ReturnType<typeof setTimeout> | undefined;

  private readonly intervalMs: number;
  private readonly initialDelayMs: number;
  private readonly maxAgeMs: number;
  private readonly minConfidence: number;

  constructor(
    private store: WarmMemoryStore,
    opts: MemoryConsolidatorOptions = {},
  ) {
    this.intervalMs = opts.intervalMs ?? 6 * 60 * 60 * 1000;
    this.maxAgeMs = opts.maxAgeMs ?? 30 * 24 * 60 * 60 * 1000;
    this.minConfidence = opts.minConfidence ?? 0.5;
    this.initialDelayMs = opts.initialDelayMs ?? 2 * 60 * 1000;
  }

  start(): void {
    if (this.timer !== undefined) return;
    this.firstRun = setTimeout(() => this.runOnce(), this.initialDelayMs);
    this.timer = setInterval(() => this.runOnce(), this.intervalMs);
    // Don't keep the process alive just for maintenance.
    this.firstRun.unref?.();
    this.timer.unref?.();
    log.info('MemoryConsolidator started', { intervalMs: this.intervalMs });
  }

  stop(): void {
    clearTimeout(this.firstRun);
    this.firstRun = undefined;
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** Run one maintenance pass. Returns what it changed. Safe to call directly (tests). */
  runOnce(now = Date.now()): { merged: number; pruned: number } {
    let merged = 0;
    let pruned = 0;
    try {
      merged = this.store.dedupeByValue(now);
      pruned = this.store.prune(
        { maxAgeMs: this.maxAgeMs, minConfidence: this.minConfidence },
        now,
      );
    } catch (err) {
      log.warn('Consolidation pass failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return { merged, pruned };
    }
    if (merged > 0 || pruned > 0) log.info('Consolidation pass', { merged, pruned });
    return { merged, pruned };
  }
}
