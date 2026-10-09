import { AsyncLocalStorage } from 'node:async_hooks';
import { createLogger } from '../logger';

const log = createLogger('llm:scheduler');

export interface LlmSchedulerOptions {
  /** Silence exigé après la dernière activité de premier plan avant tout travail de fond (ms). */
  quietMs?: number;
  /** Après du travail de fond, on re-préchauffe le cache seulement si l'utilisateur était là il y a moins que ça (ms). */
  primeWindowMs?: number;
  /** Délai entre la fin du travail de fond et le re-préchauffage (ms) — regroupe les rafales. */
  primeDelayMs?: number;
  /** Granularité de l'attente d'un créneau calme (ms). */
  pollMs?: number;
  now?: () => number;
}

/** Erreur levée quand une attente ou un appel de fond est abandonné (arrêt, appelant). */
export class BackgroundAbortedError extends Error {
  constructor() {
    super('Travail de fond abandonné');
    this.name = 'BackgroundAbortedError';
  }
}

/**
 * Priorité du premier plan sur le GPU — le levier de latence n°1 en local.
 *
 * Ollama sert UNE requête à la fois par modèle, avec UN cache de prompt. Mesuré
 * le 2026-10-08 (qwen3:14b, RX 6700) : une tâche de fond lancée juste après une
 * réponse (extraction de faits) faisait attendre la question suivante, et son
 * prompt remplaçait celui de la conversation dans le cache — le prompt système
 * entier était relu au tour suivant.
 *
 * Règles :
 * - un run de l'utilisateur ouvre une fenêtre `beginForeground`/`endForeground` ;
 * - un appel de fond (`runPreemptible`) attend `quietMs` sans activité, puis
 *   s'exécute ; un run qui démarre l'INTERROMPT (requête HTTP annulée, Ollama
 *   lâche le GPU) et l'appel est relancé au créneau calme suivant ;
 * - `schedule(clé, tâche)` sérialise les tâches par tour (faits, compaction) et
 *   les déduplique : la plus récente remplace celle qui attend encore ;
 * - après du travail de fond, `primer` (s'il est fourni) re-préchauffe le cache
 *   du prompt système, pour que la prochaine question ne paie pas la relecture.
 */
export class LlmScheduler {
  private foreground = 0;
  private lastForegroundEnd: number | null = null;
  private readonly preemptible = new Set<AbortController>();
  private readonly pending = new Map<string, () => Promise<void>>();
  private draining = false;
  private primer: ((signal: AbortSignal) => Promise<void>) | undefined;
  private primeTimer: ReturnType<typeof setTimeout> | undefined;
  private priming = false;
  private readonly disposed = new AbortController();
  /** Marque le code exécuté pour un run (outils compris), voir . */
  private readonly foregroundContext = new AsyncLocalStorage<true>();

  private readonly quietMs: number;
  private readonly primeWindowMs: number;
  private readonly primeDelayMs: number;
  private readonly pollMs: number;
  private readonly now: () => number;

  constructor(opts: LlmSchedulerOptions = {}) {
    this.quietMs = opts.quietMs ?? 90_000;
    this.primeWindowMs = opts.primeWindowMs ?? 4 * 60_000;
    this.primeDelayMs = opts.primeDelayMs ?? 3_000;
    this.pollMs = opts.pollMs ?? 1_000;
    this.now = opts.now ?? Date.now;
  }

  /** Re-préchauffage du cache après du travail de fond (voir la doc de classe). */
  setPrimer(primer: (signal: AbortSignal) => Promise<void>): void {
    this.primer = primer;
  }

  /** L'utilisateur attend une réponse : le travail de fond cède la place immédiatement. */
  beginForeground(): void {
    this.foreground++;
    this.clearPrimeTimer();
    if (this.preemptible.size > 0) {
      log.info('Travail de fond interrompu au profit du premier plan', {
        calls: this.preemptible.size,
      });
      for (const controller of this.preemptible) controller.abort();
    }
  }

  endForeground(): void {
    this.foreground = Math.max(0, this.foreground - 1);
    this.lastForegroundEnd = this.now();
  }

  /**
   * Exécute `fn` en contexte « premier plan ». Un appel de fond lancé depuis
   * ce contexte — un outil qui résume, PENDANT un run — s'exécute aussitôt : il
   * attendrait sinon la fin du run, qui l'attend lui-même (interblocage).
   */
  inForeground<T>(fn: () => T): T {
    return this.foregroundContext.run(true, fn);
  }

  /** Vrai si rien ne tourne au premier plan depuis `quietMs`. */
  isQuiet(): boolean {
    if (this.foreground > 0) return false;
    return this.lastForegroundEnd === null || this.now() - this.lastForegroundEnd >= this.quietMs;
  }

  /** Attend un créneau calme. Lève `BackgroundAbortedError` si `signal` (ou l'arrêt) l'annule. */
  async waitForQuiet(signal?: AbortSignal): Promise<void> {
    const stop = signal ? AbortSignal.any([signal, this.disposed.signal]) : this.disposed.signal;
    while (!this.isQuiet()) {
      if (stop.aborted) throw new BackgroundAbortedError();
      await sleep(this.pollMs, stop);
    }
    if (stop.aborted) throw new BackgroundAbortedError();
  }

  /**
   * Exécute un appel LLM de fond : attend le calme, l'exécute avec un signal
   * que le premier plan peut annuler, et le relance tant qu'il est interrompu
   * par l'utilisateur. `fn` DOIT lever quand son signal est annulé (jamais
   * rendre un résultat partiel). Lève si `signal` (l'appelant) ou l'arrêt annule.
   */
  async runPreemptible<T>(
    fn: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (this.foregroundContext.getStore() === true) return fn(signal ?? this.disposed.signal);
    for (;;) {
      await this.waitForQuiet(signal);
      const controller = new AbortController();
      this.preemptible.add(controller);
      const combined = AbortSignal.any([
        controller.signal,
        this.disposed.signal,
        ...(signal ? [signal] : []),
      ]);
      try {
        const result = await fn(combined);
        if (!this.priming) this.armPrime();
        return result;
      } catch (err) {
        const preempted =
          controller.signal.aborted && !this.disposed.signal.aborted && !signal?.aborted;
        if (!preempted) throw err;
        log.debug('Appel de fond relancé après le premier plan');
      } finally {
        this.preemptible.delete(controller);
      }
    }
  }

  /**
   * Planifie une tâche de fond dédupliquée par clé : si une tâche de même clé
   * attend encore, elle est remplacée (la plus récente porte l'état le plus
   * complet). Les tâches s'exécutent une à une, chacune après un créneau calme.
   * Ne lève jamais : un échec est journalisé.
   */
  schedule(key: string, task: () => Promise<void>): void {
    if (this.disposed.signal.aborted) return;
    this.pending.delete(key);
    this.pending.set(key, task);
    // Hors du contexte « premier plan » : `schedule` est appelé à la fin d'un
    // run, et le contexte asynchrone se propagerait à toute la file — ses
    // appels passeraient pour du premier plan, donc ininterruptibles.
    this.foregroundContext.exit(() => void this.drain());
  }

  /** Tâches planifiées pas encore démarrées (tests, diagnostic). */
  get pendingCount(): number {
    return this.pending.size;
  }

  /** Arrêt du runtime : annule les attentes et les appels de fond en cours. */
  dispose(): void {
    this.pending.clear();
    this.clearPrimeTimer();
    this.disposed.abort();
    for (const controller of this.preemptible) controller.abort();
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.pending.size > 0 && !this.disposed.signal.aborted) {
        await this.waitForQuiet();
        const next = this.pending.entries().next();
        if (next.done) break;
        const [key, task] = next.value;
        this.pending.delete(key);
        try {
          await task();
        } catch (err) {
          if (!this.disposed.signal.aborted) {
            log.warn('Tâche de fond en échec', { key, error: String(err) });
          }
        }
      }
    } catch {
      // Arrêt du runtime pendant l'attente : on abandonne la file.
    } finally {
      this.draining = false;
    }
  }

  private armPrime(): void {
    if (this.primer === undefined || this.lastForegroundEnd === null) return;
    if (this.now() - this.lastForegroundEnd > this.primeWindowMs) return;
    this.clearPrimeTimer();
    this.primeTimer = setTimeout(() => {
      this.primeTimer = undefined;
      void this.prime();
    }, this.primeDelayMs);
    (this.primeTimer as { unref?: () => void }).unref?.();
  }

  private async prime(): Promise<void> {
    const primer = this.primer;
    if (primer === undefined || this.priming || this.preemptible.size > 0) return;
    this.priming = true;
    try {
      await this.runPreemptible(primer);
      log.info('Cache du prompt système re-préchauffé après le travail de fond');
    } catch (err) {
      if (!this.disposed.signal.aborted)
        log.debug('Re-préchauffage abandonné', { error: String(err) });
    } finally {
      this.priming = false;
    }
  }

  private clearPrimeTimer(): void {
    if (this.primeTimer !== undefined) {
      clearTimeout(this.primeTimer);
      this.primeTimer = undefined;
    }
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}
