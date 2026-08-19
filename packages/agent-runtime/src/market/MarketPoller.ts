import { RPC_NOTIFICATIONS } from '@catdesk/shared-types';
import type { MarketService } from './MarketService';
import { stdoutNotifier } from '../ipc/Notifier';
import { createLogger } from '../logger';

const log = createLogger('market:poller');

/**
 * Tâche de fond : rafraîchit la watchlist à intervalle régulier et pousse un
 * `market.update` (notification stdout → bras Rust → event Tauri → UI).
 */
/** Bornes de la période de rafraîchissement : assez espacé pour ne pas se faire
 *  jeter par le fournisseur de cotations, assez court pour rester utile. */
const MIN_INTERVAL_MS = 10_000;
const MAX_INTERVAL_MS = 3_600_000;

export class MarketPoller {
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly service: MarketService,
    private intervalMs: number = 30_000,
  ) {}

  start(): void {
    void this.tick();
    this.arm();
  }

  /**
   * Change la période (réglage « Rafraîchissement des cours » de l'UI). Sans
   * effet si la valeur est identique ou hors bornes. Réarme le timer seulement
   * si la tâche tournait déjà.
   */
  setIntervalMs(ms: number): void {
    if (!Number.isFinite(ms)) return;
    const next = Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, Math.round(ms)));
    if (next === this.intervalMs) return;
    this.intervalMs = next;
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.arm();
    }
  }

  private arm(): void {
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** Rafraîchit et pousse immédiatement (hors cycle), ex. après un changement de watchlist. */
  async refreshNow(): Promise<void> {
    await this.tick();
  }

  private async tick(): Promise<void> {
    try {
      const snapshot = await this.service.refresh();
      stdoutNotifier(RPC_NOTIFICATIONS.marketUpdate, snapshot);
    } catch (err) {
      log.error('market refresh failed', { error: String(err) });
    }
  }
}
