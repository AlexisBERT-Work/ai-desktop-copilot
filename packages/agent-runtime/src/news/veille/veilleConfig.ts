import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isEmailAddress } from '@catdesk/shared-types';
import { EMPTY_STATE, VeilleStateSchema, type VeilleState } from './collectRepos';

// Configuration de la veille GitHub, en deux temps autour de la rédaction par
// Claude Code (.github/workflows/ai-veille.yml) :
//   collecte  (cli/veilleCollect.ts) : GH_TOKEN, VEILLE_CONTEXT, VEILLE_WINDOW_DAYS,
//                                      VEILLE_PER_DOMAIN
//   envoi     (cli/veilleSend.ts)    : VEILLE_TO, VEILLE_DRY_RUN, VEILLE_OUT + SMTP_*
// Les deux partagent VEILLE_WORKDIR (échange avec Claude) et VEILLE_ARCHIVE
// (ce qui survit d'un run à l'autre).

type EnvLike = Record<string, string | undefined>;

export const STATE_FILE = 'vus.json';
export const REPORTS_DIR = 'rapports';

/** Assez large pour ne rien rater après quelques matins sans run. */
const DEFAULT_WINDOW_DAYS = 14;
/** 4 domaines : ~60 dossiers, ce que Claude peut comparer en un seul appel. */
const DEFAULT_PER_DOMAIN = 15;

function workdir(env: EnvLike): string {
  return env['VEILLE_WORKDIR']?.trim() || 'veille-work';
}

function archiveDir(env: EnvLike): string {
  return env['VEILLE_ARCHIVE']?.trim() || join(workdir(env), 'archive');
}

function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value ?? '');
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export interface VeilleCollectConfig {
  workdir: string;
  archiveDir: string;
  /** Racine d'un dépôt CatDesk dont on lit les documents de contexte. */
  contextDir: string;
  token: string;
  windowDays: number;
  perDomain: number;
}

/** Configuration de la collecte ; exige un jeton (la recherche anonyme est trop bridée). Pur. */
export function readVeilleCollectConfig(
  env: EnvLike,
): { ok: true; config: VeilleCollectConfig } | { ok: false; error: string } {
  const token = env['GH_TOKEN']?.trim();
  if (!token) return { ok: false, error: 'GH_TOKEN manquant (jeton de l’API GitHub).' };
  return {
    ok: true,
    config: {
      workdir: workdir(env),
      archiveDir: archiveDir(env),
      contextDir: env['VEILLE_CONTEXT']?.trim() || '../..',
      token,
      windowDays: positiveInt(env['VEILLE_WINDOW_DAYS'], DEFAULT_WINDOW_DAYS),
      perDomain: positiveInt(env['VEILLE_PER_DOMAIN'], DEFAULT_PER_DOMAIN),
    },
  };
}

export interface VeilleSendConfig {
  workdir: string;
  archiveDir: string;
  /** Destinataire ; null seulement en essai à blanc. */
  to: string | null;
  /** Essai à blanc : rien n'est envoyé ni archivé, l'aperçu HTML est écrit dans `out`. */
  dryRun: boolean;
  out: string;
}

/** Configuration de l'envoi ; exige un destinataire valide hors essai à blanc. Pur. */
export function readVeilleSendConfig(
  env: EnvLike,
): { ok: true; config: VeilleSendConfig } | { ok: false; error: string } {
  const dryRun = env['VEILLE_DRY_RUN'] === '1' || env['VEILLE_DRY_RUN'] === 'true';
  const to = env['VEILLE_TO']?.trim() || null;
  if (to === null && !dryRun) {
    return { ok: false, error: 'VEILLE_TO manquant (adresse qui reçoit le rapport).' };
  }
  if (to !== null && !isEmailAddress(to)) {
    return { ok: false, error: 'VEILLE_TO invalide : ce n’est pas une adresse e-mail.' };
  }
  return {
    ok: true,
    config: {
      workdir: workdir(env),
      archiveDir: archiveDir(env),
      to,
      dryRun,
      out: env['VEILLE_OUT']?.trim() || 'veille-preview.html',
    },
  };
}

/**
 * Relit ce qui a déjà été vu. Absent = premier run. Illisible = erreur, et non
 * un départ à vide : on renverrait tous les dépôts déjà vus, et l'archive serait
 * écrasée par une archive vide.
 */
export function loadVeilleState(dir: string): VeilleState {
  const path = join(dir, STATE_FILE);
  if (!existsSync(path)) return EMPTY_STATE;
  return VeilleStateSchema.parse(JSON.parse(readFileSync(path, 'utf-8')));
}
