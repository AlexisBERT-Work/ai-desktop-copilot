import type { OllamaClient } from '../llm/OllamaClient';
import { buildPressDailies, type JournalDraft } from './pressDigest';
import { buildTopicDigest } from './topicDigest';
import { buildCustomJournalDailies } from './customJournalDigest';
import { fetchEnabledPressFeeds } from './PressFeedStore';
import {
  publishDailies,
  publishDailiesOpen,
  hasTodaysSharedDigest,
  type SupabaseAdminConfig,
  type SupabaseOpenConfig,
} from './SupabasePublisher';
import { publishDailiesToDiscord } from './DiscordDailyPublisher';
import { createLogger } from '../logger';

const log = createLogger('news:press-scheduler');
const CHECK_MS = 15 * 60 * 1000;

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
  /**
   * Session anonyme (clé publique) — TOUJOURS requise : c'est elle qui permet
   * au lot standard (journaux + sujets + synthèse) de se publier depuis
   * n'importe quel poste, sans identifiants admin (tri modèles 2026-07-20).
   */
  supabase: SupabaseOpenConfig;
  /**
   * Identifiants admin — OPTIONNELS : n'activent que les extras réservés à
   * l'admin (journaux personnalisés `press_feeds`, dailys manuelles restant
   * sur l'ancien chemin `publishDailies`). Absents ⇒ le lot standard se publie
   * quand même, juste sans ces extras.
   */
  admin?: SupabaseAdminConfig;
  /** Webhook Discord optionnel : miroite les dailys publiées. Vide = désactivé. */
  discordWebhook?: string;
}

/** Clé de jour local (ex. « 2026-7-4 »). Pur, exporté pour tests. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/**
 * La publication du jour est-elle due ? Vrai dès que l'heure de publication
 * est atteinte et qu'aucun run n'a réussi aujourd'hui. Pur, exporté pour tests.
 */
export function isRunDue(hour: number, lastRunDay: string | null, now = new Date()): boolean {
  return now.getHours() >= hour && dayKey(now) !== lastRunDay;
}

/**
 * Publie chaque jour une daily par journal (analyse intra-journal IA). Tourne
 * sur TOUT poste ayant lancé CatDesk (tri modèles 2026-07-20 — publication
 * ouverte, sans identifiants admin) ; les identifiants admin, s'ils sont
 * configurés sur ce poste, activent en plus les journaux personnalisés et le
 * miroir Discord — voir index.ts. Idempotent : rejouer une même journée, ou
 * qu'un autre poste ait déjà publié avant nous, ne crée pas de doublons.
 *
 * Planification par « rattrapage » : on vérifie toutes les 15 min si la
 * publication du jour est due (heure atteinte, pas encore faite). Un PC éteint
 * ou en veille à l'heure dite publie donc dès son retour, au lieu de sauter la
 * journée — les setTimeout longs ne survivent ni à la veille ni aux redémarrages.
 */
export class PressDigestScheduler {
  private interval: ReturnType<typeof setInterval> | null = null;
  private running = false;
  /** Jour local du dernier run réussi (null = aucun depuis le démarrage). */
  private lastRunDay: string | null = null;

  constructor(
    private readonly llm: OllamaClient,
    private readonly model: string,
    private readonly cfg: PressDigestConfig,
  ) {}

  start(): void {
    this.interval = setInterval(() => void this.checkDue(), CHECK_MS);
    log.info('Press digest scheduled', {
      hour: this.cfg.hour,
      checkEveryMin: CHECK_MS / 60_000,
      sources: this.cfg.sourceIds.length,
      runOnStart: this.cfg.runOnStart,
    });
    // Publication immédiate optionnelle (idempotente : pas de doublon le même
    // jour), sinon rattrapage immédiat si l'heure du jour est déjà passée.
    if (this.cfg.runOnStart) void this.tryRun();
    else void this.checkDue();
  }

  stop(): void {
    if (this.interval !== null) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  /** Lance le run du jour s'il est dû. En cas d'échec, retentera au tick suivant. */
  private async checkDue(): Promise<void> {
    if (!isRunDue(this.cfg.hour, this.lastRunDay)) return;
    await this.tryRun();
  }

  private async tryRun(): Promise<void> {
    if (await this.runOnce()) this.lastRunDay = dayKey(new Date());
  }

  /** @returns vrai si le run est allé au bout (même partiellement publié, ou déjà fait par un autre poste). */
  async runOnce(): Promise<boolean> {
    if (this.running) return false;
    this.running = true;
    try {
      // Un autre poste a peut-être déjà publié le lot standard du jour (tri
      // modèles 2026-07-20 : n'importe quel poste peut désormais le faire).
      // On économise la génération LLM locale si c'est déjà fait ailleurs.
      if (await hasTodaysSharedDigest(this.cfg.supabase)) {
        log.info('Revue de presse du jour déjà publiée (autre poste) — rien à générer');
        return true;
      }

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

      // Lot standard : publication ouverte (session anonyme + RPC), sans
      // identifiants admin — c'est elle qui rend le run possible sur N'IMPORTE
      // QUEL poste. Idempotente : un titre déjà publié par un autre poste
      // devient un skip silencieux, jamais une erreur.
      const res = await publishDailiesOpen(this.cfg.supabase, drafts);
      log.info('Press digest run complete (open)', {
        mode,
        published: res.published,
        skipped: res.skipped,
        errors: res.errors.length,
      });

      // Extras réservés à l'admin — n'existent que sur le(s) poste(s) où les
      // identifiants admin sont configurés ; absents ⇒ le lot standard
      // ci-dessus a suffi, on s'arrête là.
      if (this.cfg.admin) {
        const admin = this.cfg.admin;
        // Journaux personnalisés (press_feeds, réservés à l'admin). Échec
        // réseau → liste vide, sans faire échouer le run.
        const feeds = await fetchEnabledPressFeeds(admin);
        if (feeds.length > 0) {
          const customDrafts = await buildCustomJournalDailies(feeds, {
            llm: this.llm,
            model: this.model,
          });
          const adminRes = await publishDailies(admin, customDrafts);
          res.publishedDrafts.push(...adminRes.publishedDrafts);
          log.info('Journaux personnalisés admin publiés', {
            feeds: feeds.length,
            published: adminRes.published,
            skipped: adminRes.skipped,
            errors: adminRes.errors.length,
          });
        }

        // Miroir Discord (optionnel) : on ne poste QUE les dailys neuves de CE
        // run (standard + extras admin), jamais celles qu'un autre poste a
        // déjà publiées avant nous — évite les doublons Discord.
        const webhook = this.cfg.discordWebhook?.trim();
        if (webhook && res.publishedDrafts.length > 0) {
          const dz = await publishDailiesToDiscord(webhook, res.publishedDrafts);
          log.info('Press digest mirrored to Discord', {
            posted: dz.posted,
            batches: dz.batches,
            errors: dz.errors.length,
          });
        }
      }
      return true;
    } catch (err) {
      log.error('Press digest run failed', { error: String(err) });
      return false;
    } finally {
      this.running = false;
    }
  }
}
