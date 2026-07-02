import type { MarketService } from './MarketService';
import { stdoutNotifier } from '../ipc/Notifier';
import { createLogger } from '../logger';

const log = createLogger('market:poller');

/**
 * Tâche de fond : rafraîchit la watchlist à intervalle régulier et pousse un
 * `market.update` (notification stdout → bras Rust → event Tauri → UI).
 */
export class MarketPoller {
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly service: MarketService,
    private readonly intervalMs: number = 30_000,
  ) {}

  start(): void {
    void this.tick();
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
      stdoutNotifier('market.update', snapshot);
    } catch (err) {
      log.error('market refresh failed', { error: String(err) });
    }
  }
}
