import type { OllamaClient } from '../llm/OllamaClient';
import { buildPressDailies } from './pressDigest';
import { publishDailies, type SupabaseAdminConfig } from './SupabasePublisher';
import { createLogger } from '../logger';

const log = createLogger('news:press-scheduler');
const DAY_MS = 24 * 60 * 60 * 1000;

export interface PressDigestConfig {
  /** Ids de sources (clés de NEWS_SOURCES). */
  sourceIds: string[];
  /** Mots-clés de filtrage (« recherche de caractères »). Vide = tout. */
  topics: string[];
  sinceHours: number;
  perJournalLimit: number;
  /** Ajoute une daily « Synthèse du jour » transversale. */
  synthesis: boolean;
  /** Heure locale de publication quotidienne (0-23). */
  hour: number;
  supabase: SupabaseAdminConfig;
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
    });
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
      const drafts = await buildPressDailies({
        llm: this.llm,
        model: this.model,
        sourceIds: this.cfg.sourceIds,
        topics: this.cfg.topics,
        sinceHours: this.cfg.sinceHours,
        perJournalLimit: this.cfg.perJournalLimit,
        synthesis: this.cfg.synthesis,
      });
      const res = await publishDailies(this.cfg.supabase, drafts);
      log.info('Press digest run complete', {
        published: res.published,
        skipped: res.skipped,
        errors: res.errors.length,
      });
    } catch (err) {
      log.error('Press digest run failed', { error: String(err) });
    } finally {
      this.running = false;
    }
  }
}
