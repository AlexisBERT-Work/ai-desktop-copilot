import type { PressDigestConfig, PressMode } from './PressDigestScheduler';
import type { SupabaseOpenConfig } from './supabaseRest';
import { envNumber } from '../config';

// Sélection de journaux par défaut pour la revue de presse quotidienne
// (finance + généraliste FR + international). Surchargeable via CATDESK_PRESS_SOURCES.
export const DEFAULT_PRESS_SOURCES = [
  'latribune',
  'cnbc',
  'lemonde',
  'lefigaro',
  'france24',
  'bbc',
  'guardian',
];

type Env = Record<string, string | undefined>;

function readPressMode(v: string | undefined): PressMode {
  return v === 'journal' || v === 'topic' || v === 'both' ? v : 'both';
}

function csv(v: string | undefined, fallback: string[]): string[] {
  const items = (v ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0);
  return items.length > 0 ? items : fallback;
}

/**
 * Config de la revue de presse partagée (dailys), ou null si désactivée.
 *
 * Active par défaut sur TOUT poste ayant lancé CatDesk (tri modèles 2026-07-20
 * — CATDESK_PRESS_DIGEST=0 pour désactiver) : le lot standard (7 journaux +
 * sujets + synthèse) se publie via une session anonyme + la RPC
 * `publish_daily_if_missing` (SECURITY DEFINER, voir
 * supabase/migrations/20260720000000_*.sql), sans identifiants admin.
 * Idempotent entre postes : le premier arrivé publie, les suivants no-opent
 * (contrainte unique sur `title`).
 *
 * Les identifiants admin (SUPABASE_ADMIN_EMAIL/PASSWORD), s'ils sont configurés
 * sur CE poste, activent en plus les extras réservés à l'admin (journaux
 * personnalisés `press_feeds`, miroir Discord) — voir PressDigestScheduler.
 */
export function readPressDigestConfig(
  env: Env,
  supabase: SupabaseOpenConfig,
  hour: number,
): PressDigestConfig | null {
  if (env['CATDESK_PRESS_DIGEST'] === '0') return null;
  const email = env['SUPABASE_ADMIN_EMAIL']?.trim();
  const password = env['SUPABASE_ADMIN_PASSWORD'];
  // Miroir Discord optionnel (extra admin) : une cible dédiée aux dailys, ou à
  // défaut le webhook général DISCORD_WEBHOOK_URL.
  const discordWebhook = (
    env['CATDESK_PRESS_DISCORD_WEBHOOK']?.trim() ||
    env['DISCORD_WEBHOOK_URL']?.trim() ||
    ''
  ).trim();

  return {
    sourceIds: csv(env['CATDESK_PRESS_SOURCES'], DEFAULT_PRESS_SOURCES),
    topics: csv(env['CATDESK_PRESS_TOPICS'], []),
    sinceHours: envNumber('CATDESK_PRESS_SINCE_HOURS', 24),
    perJournalLimit: envNumber('CATDESK_PRESS_LIMIT', 10),
    mode: readPressMode(env['CATDESK_PRESS_MODE']),
    topicLimit: envNumber('CATDESK_PRESS_TOPIC_LIMIT', 40),
    synthesis: env['CATDESK_PRESS_SYNTHESIS'] !== '0',
    hour,
    runOnStart: env['CATDESK_PRESS_RUN_ON_START'] === '1',
    supabase,
    ...(email && password ? { admin: { ...supabase, email, password } } : {}),
    ...(discordWebhook.length > 0 ? { discordWebhook } : {}),
  };
}
