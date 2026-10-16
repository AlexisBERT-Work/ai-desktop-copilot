import { EMPTY_PRESS_FEED, PRESS_SOURCE_CATALOG, isEmailAddress } from '@catdesk/shared-types';
import type { OllamaClient } from '../llm/OllamaClient';
import { buildCustomJournalDaily } from './customJournalDigest';
import { renderDailyEmail, type DailyMailer } from './dailyEmail';
import { NEWS_SOURCES } from './sources';

// Récap par e-mail SANS l'application : un journal défini par l'environnement,
// collecté, rédigé et envoyé en une passe. Lancé chaque matin par GitHub
// Actions (.github/workflows/ai-recap.yml), PC éteint — voir `cli/emailRecap.ts`.

type EnvLike = Record<string, string | undefined>;

/** Sources du groupe « IA » du catalogue : le défaut du récap. */
export const AI_SOURCE_IDS: readonly string[] = PRESS_SOURCE_CATALOG.filter(
  s => s.group === 'ai',
).map(s => s.id);

/**
 * Modèle du récap dans le cloud (processeur seul). Surtout PAS `qwen3:4b` :
 * depuis la mise à jour 2507, ce tag désigne la variante qui raisonne
 * toujours et ignore `think: false` — 2 754 tokens de réflexion pour une
 * phrase, chaque appel du pipeline au délai de 10 min (essai du 2026-10-16).
 */
export const RECAP_DEFAULT_MODEL = 'qwen3:4b-instruct-2507-q4_K_M';

/** Fenêtre par défaut quand aucun envoi précédent n'est connu (premier run). */
const DEFAULT_WINDOW_HOURS = 24;
/** Au-delà (plusieurs matins ratés), le mail deviendrait indigeste. */
const MAX_WINDOW_HOURS = 72;

/**
 * Fenêtre de collecte « depuis le dernier envoi », en heures entières : du
 * début du dernier run réussi à maintenant, bornée à [1, 72]. Sans date (ou
 * date illisible) : 24 h. Pur, exporté pour tests.
 */
export function recapWindowHours(lastSentIso: string | undefined, now = new Date()): number {
  const last = lastSentIso?.trim() ? Date.parse(lastSentIso) : Number.NaN;
  if (Number.isNaN(last)) return DEFAULT_WINDOW_HOURS;
  const hours = Math.ceil((now.getTime() - last) / 3_600_000);
  return Math.min(MAX_WINDOW_HOURS, Math.max(1, hours));
}

export interface RecapConfig {
  /** Destinataire ; null seulement en essai à blanc. */
  to: string | null;
  /** Nom du journal (titre et sujet du mail). */
  name: string;
  sourceIds: string[];
  articleLimit: number;
  sinceHours: number;
  model: string;
  /** Essai à blanc : rien n'est envoyé, l'aperçu HTML est écrit dans `out`. */
  dryRun: boolean;
  out: string;
}

function csv(v: string | undefined): string[] {
  return (v ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

/**
 * Configuration du récap depuis l'environnement (variables RECAP_*, vide =
 * absente). Refuse une source inconnue ou un destinataire manquant hors essai
 * à blanc. Pur, exporté pour tests.
 */
export function readRecapConfig(
  env: EnvLike,
  now = new Date(),
): { ok: true; config: RecapConfig } | { ok: false; error: string } {
  const dryRun = env['RECAP_DRY_RUN'] === '1' || env['RECAP_DRY_RUN'] === 'true';
  const to = env['RECAP_TO']?.trim() || null;
  if (to === null && !dryRun) {
    return { ok: false, error: 'RECAP_TO manquant (adresse qui reçoit le récap).' };
  }
  if (to !== null && !isEmailAddress(to)) {
    return { ok: false, error: 'RECAP_TO invalide : ce n’est pas une adresse e-mail.' };
  }

  const requested = csv(env['RECAP_SOURCES']);
  const sourceIds = requested.length > 0 ? requested : [...AI_SOURCE_IDS];
  const unknown = sourceIds.filter(id => !(id in NEWS_SOURCES));
  if (unknown.length > 0) {
    return { ok: false, error: `RECAP_SOURCES : source(s) inconnue(s) — ${unknown.join(', ')}` };
  }

  const limit = Number(env['RECAP_LIMIT'] ?? '');
  return {
    ok: true,
    config: {
      to,
      name: env['RECAP_NAME']?.trim() || 'Actu IA',
      sourceIds,
      articleLimit: Number.isInteger(limit) && limit > 0 ? Math.min(limit, 40) : 12,
      sinceHours: recapWindowHours(env['RECAP_SINCE'], now),
      model: env['RECAP_MODEL']?.trim() || RECAP_DEFAULT_MODEL,
      dryRun,
      out: env['RECAP_OUT']?.trim() || 'recap-preview.html',
    },
  };
}

export type RecapOutcome =
  | { state: 'sent'; subject: string; articles: number }
  | { state: 'dry-run'; subject: string; articles: number; html: string; text: string }
  | { state: 'empty' }
  | { state: 'error'; error: string };

export interface RecapDeps {
  llm: OllamaClient;
  mailer: DailyMailer;
  now?: Date;
}

/**
 * Collecte, rédige et envoie le récap. « empty » = aucun article dans la
 * fenêtre : rien n'est envoyé, et ce n'est pas une erreur.
 */
export async function runEmailRecap(cfg: RecapConfig, deps: RecapDeps): Promise<RecapOutcome> {
  const now = deps.now ?? new Date();
  const draft = await buildCustomJournalDaily(
    {
      ...EMPTY_PRESS_FEED,
      id: 'email-recap',
      name: cfg.name,
      category: 'tech',
      sourceIds: cfg.sourceIds,
      sinceHours: cfg.sinceHours,
      articleLimit: cfg.articleLimit,
      emailTo: cfg.to,
    },
    { llm: deps.llm, model: cfg.model, now },
  );
  if (draft === null) return { state: 'empty' };

  const articles = draft.body.split('\n').filter(l => l.startsWith('- ')).length;
  const msg = renderDailyEmail([{ title: draft.title, body: draft.body }], now);
  if (cfg.dryRun || cfg.to === null) {
    return { state: 'dry-run', subject: msg.subject, articles, html: msg.html, text: msg.text };
  }
  const res = await deps.mailer({ to: cfg.to, ...msg });
  return res.ok
    ? { state: 'sent', subject: msg.subject, articles }
    : { state: 'error', error: res.error };
}
