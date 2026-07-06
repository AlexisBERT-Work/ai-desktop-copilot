import type { Daily } from '@catdesk/shared-types';
import type { OllamaClient } from '../llm/OllamaClient';
import { buildCustomJournalDailies } from './customJournalDigest';
import { dayKey, isRunDue } from './PressDigestScheduler';
import type { LocalPressFeedStore } from './LocalPressFeedStore';
import type { LocalDailyStore } from './LocalDailyStore';
import { createLogger } from '../logger';

const log = createLogger('news:local-press');
const CHECK_MS = 15 * 60 * 1000;

/**
 * Génère chaque jour les dailys des journaux personnalisés DE CE POSTE — pour
 * tout utilisateur, sans rôle admin ni Supabase. Même planification par
 * rattrapage que le digest partagé : vérification toutes les 15 min, publication
 * dès que l'heure du jour est atteinte (PC allumé tard ⇒ rattrapage immédiat).
 *
 * Un jour sans journal actif n'est PAS marqué comme fait : ajouter un journal
 * dans la journée déclenche la génération au tick suivant.
 */
export class LocalPressScheduler {
  private interval: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private lastRunDay: string | null = null;

  constructor(
    private readonly llm: OllamaClient,
    private readonly model: string,
    private readonly feeds: LocalPressFeedStore,
    private readonly dailies: LocalDailyStore,
    private readonly hour: number,
    /** Poussé vers l'UI (notification `dailies.local`) après toute génération. */
    private readonly onUpdate?: (dailies: Daily[]) => void,
  ) {}

  start(): void {
    this.interval = setInterval(() => void this.checkDue(), CHECK_MS);
    log.info('Local press scheduler started', {
      hour: this.hour,
      checkEveryMin: CHECK_MS / 60_000,
      feeds: this.feeds.list().length,
    });
    void this.checkDue();
  }

  stop(): void {
    if (this.interval !== null) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private async checkDue(): Promise<void> {
    if (!isRunDue(this.hour, this.lastRunDay)) return;
    if (await this.runOnce()) this.lastRunDay = dayKey(new Date());
  }

  /**
   * Collecte + rédige les dailys des journaux actifs, ajoute les nouvelles
   * (idempotent par titre) et notifie l'UI. Déclenchable aussi via
   * `press.local.run_now` (bouton « Générer maintenant »).
   * @returns vrai si le run compte comme fait pour aujourd'hui.
   */
  async runOnce(): Promise<boolean> {
    if (this.running) return false;
    const active = this.feeds.list().filter((f) => f.enabled);
    if (active.length === 0) return false;

    this.running = true;
    try {
      const drafts = await buildCustomJournalDailies(active, { llm: this.llm, model: this.model });
      const added = this.dailies.addNew(drafts);
      log.info('Local press run complete', {
        feeds: active.length,
        built: drafts.length,
        added: added.length,
      });
      if (added.length > 0) this.onUpdate?.(this.dailies.list());
      return true;
    } catch (err) {
      log.error('Local press run failed', { error: String(err) });
      return false;
    } finally {
      this.running = false;
    }
  }
}
