import { createLogger } from '../logger';

const log = createLogger('lib:circuit');

/**
 * Coupe-circuit par source (veille 2026-08-16, idée retenue d'OmniRoute).
 *
 * Complète `withRetry`, qui traite l'échec *transitoire* (un hoquet réseau) en
 * réessayant tout de suite. Le cas non couvert jusqu'ici est l'échec *durable* :
 * un flux RSS mort, un domaine qui ne résout plus, une API qui refuse — chaque
 * cycle du planificateur repayait alors le timeout complet, indéfiniment, pour
 * un résultat connu d'avance.
 *
 * Trois états par clé :
 * - `closed`    — nominal, tout passe.
 * - `open`      — N échecs consécutifs : on refuse sans appeler, pendant `cooldownMs`.
 * - `half-open` — après le cooldown, UN essai est laissé passer. Il réussit →
 *   `closed` ; il échoue → `open` pour un nouveau cooldown.
 *
 * En mémoire et par processus : c'est un garde-fou d'efficacité, pas un état
 * métier à persister. Horloge injectable pour des tests sans minuteur réel.
 */

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  /** Échecs consécutifs avant ouverture. Défaut 3. */
  failureThreshold?: number;
  /** Durée pendant laquelle une source ouverte est ignorée. Défaut 5 min. */
  cooldownMs?: number;
  /** Horloge injectable (tests). */
  now?: () => number;
}

/** Rejet dû au coupe-circuit — jamais une erreur de la source elle-même. */
export class CircuitOpenError extends Error {
  constructor(
    readonly key: string,
    readonly retryInMs: number,
  ) {
    super(
      `Source « ${key} » temporairement écartée (échecs répétés) — nouvel essai dans ${Math.ceil(retryInMs / 1000)}s`,
    );
    this.name = 'CircuitOpenError';
  }
}

interface Entry {
  failures: number;
  openedAt: number | null;
  /** Un essai est déjà en vol en half-open : les autres restent refusés. */
  probing: boolean;
}

export class CircuitBreaker {
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private readonly entries = new Map<string, Entry>();

  constructor(opts: CircuitBreakerOptions = {}) {
    this.failureThreshold = opts.failureThreshold ?? 3;
    this.cooldownMs = opts.cooldownMs ?? 5 * 60 * 1000;
    this.now = opts.now ?? (() => Date.now());
  }

  private entry(key: string): Entry {
    let e = this.entries.get(key);
    if (!e) {
      e = { failures: 0, openedAt: null, probing: false };
      this.entries.set(key, e);
    }
    return e;
  }

  state(key: string): CircuitState {
    const e = this.entries.get(key);
    if (!e || e.openedAt === null) return 'closed';
    return this.now() - e.openedAt >= this.cooldownMs ? 'half-open' : 'open';
  }

  /** Millisecondes restantes avant le prochain essai (0 si la source passe). */
  retryInMs(key: string): number {
    const e = this.entries.get(key);
    if (!e || e.openedAt === null) return 0;
    return Math.max(0, e.openedAt + this.cooldownMs - this.now());
  }

  recordSuccess(key: string): void {
    const e = this.entry(key);
    if (e.openedAt !== null) log.info('Circuit closed again', { key });
    e.failures = 0;
    e.openedAt = null;
    e.probing = false;
  }

  recordFailure(key: string): void {
    const e = this.entry(key);
    e.probing = false;
    e.failures++;
    if (e.failures >= this.failureThreshold) {
      // Réarme la fenêtre : un essai half-open raté vaut une nouvelle ouverture.
      e.openedAt = this.now();
      log.warn('Circuit opened', { key, failures: e.failures, cooldownMs: this.cooldownMs });
    }
  }

  /**
   * Exécute `fn` sous protection. Lève `CircuitOpenError` **sans appeler `fn`**
   * quand la source est écartée ; sinon propage l'erreur d'origine après l'avoir
   * comptabilisée. L'appelant distingue les deux via `instanceof`.
   */
  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const state = this.state(key);
    const e = this.entry(key);

    if (state === 'open' || (state === 'half-open' && e.probing)) {
      throw new CircuitOpenError(key, this.retryInMs(key));
    }
    if (state === 'half-open') e.probing = true;

    try {
      const result = await fn();
      this.recordSuccess(key);
      return result;
    } catch (err) {
      this.recordFailure(key);
      throw err;
    }
  }

  /** Remet une source (ou tout) à zéro — reprise manuelle après correction. */
  reset(key?: string): void {
    if (key === undefined) this.entries.clear();
    else this.entries.delete(key);
  }
}
