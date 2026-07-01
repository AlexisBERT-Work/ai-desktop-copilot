import type { OllamaClient } from '../llm/OllamaClient';
import { buildPressDailies, type JournalDraft } from './pressDigest';
import { buildTopicDigest } from './topicDigest';
import { publishDailies, type SupabaseAdminConfig } from './SupabasePublisher';
import { publishDailiesToDiscord } from './DiscordDailyPublisher';
import { createLogger } from '../logger';

const log = createLogger('news:press-scheduler');
const DAY_MS = 24 * 60 * 60 * 1000;

/** Organisation des dailys : par journal, par sujet (transversal), ou les deux. */
export type PressMode = 'journal' | 'topic' | 'both';

export interface PressDigestConfig {
  /** Ids de sources (clés de NEWS_SOURCES). */
  sourceIds: string[];
  /** Mots-clés de filtrage (« recherche de caractères »). Vide = tout. */
  topics: string[];
  sinceHours: number;
  perJournalLimit: number;
  /** Mode d'organisation des dailys produites. */
  mode: PressMode;
  /** Nb d'articles (les plus importants) soumis au regroupement par sujet. */
  topicLimit: number;
  /** Ajoute une daily « Synthèse du jour » transversale (mode journal/both). */
  synthesis: boolean;
  /** Heure locale de publication quotidienne (0-23). */
  hour: number;
  /** Lance aussi une publication immédiate au démarrage (vérif/premier remplissage). */
  runOnStart: boolean;
  supabase: SupabaseAdminConfig;
  /** Webhook Discord optionnel : miroite les dailys publiées. Vide = désactivé. */
  discordWebhook?: string;
}

/** Ms jusqu'à la prochaine occurrence de `hour:00` locale. Pur, exporté pour tests. */
export function msUntilHour(hour: number, now = new Date()): number {
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

/**
 * Publie chaque jour une daily par journal (analyse intra-journal IA). Tourne
 * uniquement sur le poste de référence (config admin présente) — voir index.ts.
 * Idempotent : rejouer une même journée ne crée pas de doublons.
 */
export class PressDigestScheduler {
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly llm: OllamaClient,
    private readonly model: string,
    private readonly cfg: PressDigestConfig,
  ) {}

  start(): void {
    const delay = msUntilHour(this.cfg.hour);
    this.timeout = setTimeout(() => {
      void this.runOnce();
      this.interval = setInterval(() => void this.runOnce(), DAY_MS);
    }, delay);
    log.info('Press digest scheduled', {
      hour: this.cfg.hour,
      firstRunInMin: Math.round(delay / 60_000),
      sources: this.cfg.sourceIds.length,
      runOnStart: this.cfg.runOnStart,
    });
    // Publication immédiate optionnelle (idempotente : pas de doublon le même jour).
    if (this.cfg.runOnStart) void this.runOnce();
  }

  stop(): void {
    if (this.timeout !== null) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
    if (this.interval !== null) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const { mode } = this.cfg;
      const drafts: JournalDraft[] = [];

      if (mode === 'journal' || mode === 'both') {
        drafts.push(
          ...(await buildPressDailies({
            llm: this.llm,
            model: this.model,
            sourceIds: this.cfg.sourceIds,
            topics: this.cfg.topics,
            sinceHours: this.cfg.sinceHours,
            perJournalLimit: this.cfg.perJournalLimit,
            synthesis: this.cfg.synthesis,
          })),
        );
      }
      if (mode === 'topic' || mode === 'both') {
        drafts.push(
          ...(await buildTopicDigest({
            llm: this.llm,
            model: this.model,
            sourceIds: this.cfg.sourceIds,
            topics: this.cfg.topics,
            sinceHours: this.cfg.sinceHours,
            limit: this.cfg.topicLimit,
          })),
        );
      }

      const res = await publishDailies(this.cfg.supabase, drafts);
      log.info('Press digest run complete', {
        mode,
        published: res.published,
        skipped: res.skipped,
        errors: res.errors.length,
      });

      // Miroir Discord (optionnel) : on ne poste QUE les dailys neuves (celles
      // réellement insérées dans Supabase), ce qui hérite de l'idempotence et
      // évite les doublons à chaque redémarrage / run-on-start.
      const webhook = this.cfg.discordWebhook?.trim();
      if (webhook && res.publishedDrafts.length > 0) {
        const dz = await publishDailiesToDiscord(webhook, res.publishedDrafts);
        log.info('Press digest mirrored to Discord', {
          posted: dz.posted,
          batches: dz.batches,
          errors: dz.errors.length,
        });
      }
    } catch (err) {
      log.error('Press digest run failed', { error: String(err) });
    } finally {
      this.running = false;
    }
  }
}
