import { createLogger } from './logger';

const log = createLogger('runtime:lifecycle');

/** Délai max d'une étape d'arrêt : une étape bloquée ne doit pas retenir les autres. */
const STEP_TIMEOUT_MS = 5_000;

/**
 * Arrêt propre du runtime. Chaque service démarré inscrit son arrêt ; à la
 * fermeture, tout s'arrête dans l'ordre INVERSE du démarrage (démons et
 * minuteurs d'abord, stores en dernier), chaque étape bornée dans le temps.
 *
 * Avant, l'arrêt n'existait que sur SIGTERM — que Windows n'envoie jamais à un
 * processus enfant — et oubliait la moitié des services ; la fermeture de
 * stdin faisait un `process.exit` sec : sidecar OCR, navigateur headless et
 * modèle en VRAM restaient à l'abandon.
 */
export class Lifecycle {
  private readonly steps: Array<{ name: string; stop: () => unknown }> = [];
  private stopping: Promise<void> | null = null;

  onShutdown(name: string, stop: () => unknown): void {
    this.steps.push({ name, stop });
  }

  /** Idempotent : un second appel renvoie l'arrêt déjà en cours. */
  shutdown(reason: string): Promise<void> {
    this.stopping ??= this.run(reason);
    return this.stopping;
  }

  private async run(reason: string): Promise<void> {
    log.info('Shutting down', { reason, steps: this.steps.length });
    for (const { name, stop } of [...this.steps].reverse()) {
      try {
        await Promise.race([
          Promise.resolve().then(stop),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('délai dépassé')), STEP_TIMEOUT_MS).unref(),
          ),
        ]);
      } catch (err) {
        log.warn('Shutdown step failed', { step: name, error: String(err) });
      }
    }
  }
}
