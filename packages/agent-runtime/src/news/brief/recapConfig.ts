import { PRESS_SOURCE_CATALOG, isEmailAddress } from '@catdesk/shared-types';
import { NEWS_SOURCES } from '../sources';
import { DEFAULT_AUDIENCE, DEFAULT_FOCUS } from './briefPrompt';

// Configuration du brief « Veille IA » quotidien, en deux temps autour de la
// rédaction par Claude Code (.github/workflows/ai-recap.yml) :
//   collecte  (cli/recapCollect.ts) : RECAP_SINCE, RECAP_SOURCES, RECAP_EXTRA_SOURCES,
//                                     RECAP_LIMIT, RECAP_AUDIENCE, RECAP_FOCUS
//   envoi     (cli/recapSend.ts)    : RECAP_TO, RECAP_DRY_RUN, RECAP_OUT + SMTP_*
// Les deux partagent RECAP_WORKDIR, le dossier d'échange avec Claude.

type EnvLike = Record<string, string | undefined>;

/**
 * Groupe « IA » écarté du brief (revue du 2026-10-21), sources qui restent au
 * catalogue pour les journaux de CatDesk :
 * - agrégats promotionnels et tutoriels techniques, qui noient le tri sans
 *   apporter de fait : Ben's Bites, Hugging Face ;
 * - flux qui refusent les serveurs de GitHub Actions (403), où tourne le
 *   brief : Commission européenne, EU AI Act Newsletter. La recherche web de
 *   Claude couvre l'AI Act.
 */
const BRIEF_EXCLUDED = new Set(['bensbites', 'huggingface', 'eu_digital', 'euaiact']);

/**
 * Sources par défaut : le groupe « IA » du catalogue (moins les exclus), plus
 * trois sources généralistes que Claude filtre (Le Monde Pixels, CNIL, Next).
 */
export const BRIEF_DEFAULT_SOURCES: readonly string[] = [
  ...PRESS_SOURCE_CATALOG.filter(s => s.group === 'ai' && !BRIEF_EXCLUDED.has(s.id)).map(s => s.id),
  'lemonde_pixels',
  'cnil',
  'nextinpact',
];

/** Fenêtre par défaut quand aucun envoi précédent n'est connu (premier run). */
const DEFAULT_WINDOW_HOURS = 24;
/** Au-delà (plusieurs matins ratés), le brief deviendrait indigeste. */
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

function csv(v: string | undefined): string[] {
  return (v ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

function workdir(env: EnvLike): string {
  return env['RECAP_WORKDIR']?.trim() || 'recap-work';
}

export interface CollectConfig {
  workdir: string;
  sourceIds: string[];
  sinceHours: number;
  /** Nombre max de candidats soumis à Claude. */
  limit: number;
  audience: string;
  /** Thèmes prioritaires du lecteur (RECAP_FOCUS, une ligne par thème). */
  focus: string;
}

/**
 * Configuration de la collecte ; refuse une source inconnue. RECAP_SOURCES
 * REMPLACE la liste par défaut ; RECAP_EXTRA_SOURCES s'y AJOUTE (sources d'un
 * secteur, ex. santé). Pur, exporté pour tests.
 */
export function readCollectConfig(
  env: EnvLike,
  now = new Date(),
): { ok: true; config: CollectConfig } | { ok: false; error: string } {
  const requested = csv(env['RECAP_SOURCES']);
  const base = requested.length > 0 ? requested : [...BRIEF_DEFAULT_SOURCES];
  const sourceIds = [...new Set([...base, ...csv(env['RECAP_EXTRA_SOURCES'])])];
  const unknown = sourceIds.filter(id => !(id in NEWS_SOURCES));
  if (unknown.length > 0) {
    return { ok: false, error: `Source(s) inconnue(s) — ${unknown.join(', ')}` };
  }
  const limit = Number(env['RECAP_LIMIT'] ?? '');
  return {
    ok: true,
    config: {
      workdir: workdir(env),
      sourceIds,
      sinceHours: recapWindowHours(env['RECAP_SINCE'], now),
      limit: Number.isInteger(limit) && limit > 0 ? Math.min(limit, 200) : 120,
      audience: env['RECAP_AUDIENCE']?.trim() || DEFAULT_AUDIENCE,
      focus: env['RECAP_FOCUS']?.trim() || DEFAULT_FOCUS,
    },
  };
}

export interface SendConfig {
  workdir: string;
  /** Destinataire ; null seulement en essai à blanc. */
  to: string | null;
  /** Essai à blanc : rien n'est envoyé, l'aperçu HTML est écrit dans `out`. */
  dryRun: boolean;
  out: string;
}

/** Configuration de l'envoi ; exige un destinataire valide hors essai à blanc. Pur. */
export function readSendConfig(
  env: EnvLike,
): { ok: true; config: SendConfig } | { ok: false; error: string } {
  const dryRun = env['RECAP_DRY_RUN'] === '1' || env['RECAP_DRY_RUN'] === 'true';
  const to = env['RECAP_TO']?.trim() || null;
  if (to === null && !dryRun) {
    return { ok: false, error: 'RECAP_TO manquant (adresse qui reçoit le récap).' };
  }
  if (to !== null && !isEmailAddress(to)) {
    return { ok: false, error: 'RECAP_TO invalide : ce n’est pas une adresse e-mail.' };
  }
  return {
    ok: true,
    config: {
      workdir: workdir(env),
      to,
      dryRun,
      out: env['RECAP_OUT']?.trim() || 'recap-preview.html',
    },
  };
}
