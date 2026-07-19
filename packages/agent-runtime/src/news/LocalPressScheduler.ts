import type { Daily, PressRunStatus } from '@catdesk/shared-types';
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
  private lastStatus: PressRunStatus | null = null;

  constructor(
    private readonly llm: OllamaClient,
    private readonly model: string,
    private readonly feeds: LocalPressFeedStore,
    private readonly dailies: LocalDailyStore,
    private readonly hour: number,
    /** Poussé vers l'UI (notification `dailies.local`) après toute génération. */
    private readonly onUpdate?: (dailies: Daily[]) => void,
    /** Progression du run (notification `press.local.progress`), pour l'UI. */
    private readonly onStatus?: (status: PressRunStatus) => void,
  ) {}

  /** Dernier statut émis (repoussé au sync de l'UI ; null = jamais couru). */
  get status(): PressRunStatus | null {
    return this.lastStatus;
  }

  private pushStatus(status: PressRunStatus): void {
    this.lastStatus = status;
    this.onStatus?.(status);
  }

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
   * Collecte + rédige les dailys des journaux actifs et notifie l'UI.
   * Run planifié : ajoute seulement les nouvelles (idempotent par titre —
   * relancer l'app ne duplique rien). Run manuel (`force`, bouton « Générer
   * maintenant » via `press.local.run_now`) : REMPLACE aussi les dailys du
   * jour déjà présentes — l'utilisateur demande une régénération, pas un no-op.
   * @returns vrai si le run compte comme fait pour aujourd'hui.
   */
  async runOnce(force = false): Promise<boolean> {
    if (this.running) return false;
    const active = this.feeds.list().filter(f => f.enabled);
    if (active.length === 0) return false;

    this.running = true;
    const total = active.length;
    // La phase 'collecte' ouvre chaque journal : elle sert de compteur.
    let current = 0;
    this.pushStatus({ state: 'running', current, total, at: new Date().toISOString() });
    try {
      const drafts = await buildCustomJournalDailies(active, {
        llm: this.llm,
        model: this.model,
        onPhase: (journal, phase) => {
          if (phase === 'collecte') current++;
          this.pushStatus({
            state: 'running',
            current,
            total,
            journal,
            phase,
            at: new Date().toISOString(),
          });
        },
      });
      const changed = force ? this.dailies.upsert(drafts) : this.dailies.addNew(drafts);
      log.info('Local press run complete', {
        feeds: active.length,
        built: drafts.length,
        changed: changed.length,
        forced: force,
      });
      if (changed.length > 0) this.onUpdate?.(this.dailies.list());
      this.pushStatus({ state: 'done', produced: changed.length, at: new Date().toISOString() });
      return true;
    } catch (err) {
      log.error('Local press run failed', { error: String(err) });
      this.pushStatus({ state: 'error', error: String(err), at: new Date().toISOString() });
      return false;
    } finally {
      this.running = false;
    }
  }
}
