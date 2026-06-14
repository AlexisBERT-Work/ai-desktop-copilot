import type { OllamaClient } from './OllamaClient';
import { createLogger } from '../logger';

const log = createLogger('llm:idle');

export interface IdleUnloaderOptions {
  /** Active le mode passif. Si false, ne décharge jamais (legacy keep_alive). */
  enabled?: boolean;
  /** Délai d'inactivité avant déchargement de la VRAM (ms). */
  idleMs?: number;
  now?: () => number;
}

/**
 * Mode passif : garde le modèle chaud TANT QUE CatDesk répond, puis le décharge
 * de la VRAM après une fenêtre d'inactivité. Objectif : ne pas monopoliser le
 * GPU quand l'utilisateur ne s'en sert pas (ex. pendant une session de jeu).
 *
 * Cycle : chaque run appelle `begin()` au démarrage (annule un déchargement en
 * attente) puis `end()` à la fin (réarme le minuteur). Des runs concurrents sont
 * comptés : on ne décharge qu'une fois le dernier terminé.
 */
export class IdleUnloader {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private active = 0;
  private lastModel: string | undefined;

  private readonly enabled: boolean;
  private readonly idleMs: number;

  constructor(
    private llm: Pick<OllamaClient, 'unload'>,
    opts: IdleUnloaderOptions = {},
  ) {
    this.enabled = opts.enabled ?? true;
    this.idleMs = opts.idleMs ?? 5 * 60 * 1000; // 5 min d'inactivité par défaut
  }

  /** Un run démarre : on annule tout déchargement programmé. */
  begin(model: string): void {
    this.lastModel = model;
    this.active++;
    this.clearTimer();
  }

  /** Un run se termine : réarme le minuteur d'inactivité s'il n'en reste aucun. */
  end(): void {
    this.active = Math.max(0, this.active - 1);
    if (this.active > 0) return;
    if (!this.enabled || this.idleMs <= 0 || this.lastModel === undefined) return;

    this.clearTimer();
    const model = this.lastModel;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      log.info('Idle window elapsed — unloading model', { model, idleMs: this.idleMs });
      void this.llm.unload(model);
    }, this.idleMs);
    // Ne pas maintenir le process en vie juste pour ce minuteur.
    (this.timer as { unref?: () => void }).unref?.();
  }

  /** Décharge tout de suite (arrêt de l'app). Best-effort. */
  async unloadNow(): Promise<void> {
    this.clearTimer();
    if (this.lastModel !== undefined) await this.llm.unload(this.lastModel);
  }

  private clearTimer(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
}
