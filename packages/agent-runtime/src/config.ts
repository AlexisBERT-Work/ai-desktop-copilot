import { join } from 'node:path';
import {
  DEFAULT_CHAT_MODEL,
  DEFAULT_EMBED_MODEL,
  DEFAULT_VISION_MODEL,
  OLLAMA_DEFAULT_URL,
} from '@catdesk/shared-types';
import { createLogger } from './logger';

const log = createLogger('runtime:config');

// Charge un .env local (gitignoré) AVANT toute lecture d'environnement —
// secrets de connecteurs (DISCORD_WEBHOOK_URL, GITHUB_TOKEN, NOTION_TOKEN…).
// Repli silencieux sur l'environnement hérité. loadEnvFile existe sur Node ≥ 20.12.
try {
  (process as { loadEnvFile?: (path?: string) => void }).loadEnvFile?.();
} catch {
  /* pas de fichier .env — on s'appuie sur l'environnement hérité */
}

/** Nombre depuis l'env : valeur malformée → warn + défaut (jamais de NaN silencieux). */
export function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    log.warn("Variable d'environnement numérique invalide — défaut appliqué", {
      name,
      raw,
      fallback,
    });
    return fallback;
  }
  return value;
}

/** Convention projet : « =0 » désactive une fonctionnalité active par défaut. */
export function envFlag(name: string): boolean {
  return process.env[name] !== '0';
}

/** Valeur d'env non vide, sinon `fallback` (une variable vide du .env.example vaut absente). */
function envString(name: string, fallback: string): string {
  const raw = process.env[name]?.trim();
  return raw !== undefined && raw.length > 0 ? raw : fallback;
}

const model = envString('CATDESK_MODEL', DEFAULT_CHAT_MODEL);

// Projet Supabase de la revue de presse (catdesk-news). URL + clé ANON : ces
// valeurs sont PUBLIQUES par construction (c'est l'usage prévu de la clé anon
// Supabase, bornée par RLS côté serveur — jamais la clé service_role) et déjà
// embarquées telles quelles dans le build desktop (VITE_SUPABASE_ANON_KEY).
// Les avoir ici en défaut permet à TOUT poste ayant lancé CatDesk de lire et
// publier le lot standard sans configuration (tri modèles 2026-07-20) —
// surchargeable via SUPABASE_URL/SUPABASE_ANON_KEY (dev/test).
const DEFAULT_SUPABASE_URL = 'https://mpnpfbfjjkujiyeqrcwc.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1wbnBmYmZqamt1aml5ZXFyY3djIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3NjMxMDksImV4cCI6MjA5ODMzOTEwOX0.mzve54klYVm97r9WFOfQht35eb2mkth5O8eNMDUfPHE';

/**
 * Configuration du runtime, lue une seule fois au démarrage (après le .env).
 * Choix de modèles : voir CLAUDE.md (contraintes VRAM RX 6700 10 Go) —
 * un seul modèle de chat (chat + digests), minicpm-v en vision (PAS llava),
 * nomic-embed-text en embeddings — défauts dans `@catdesk/shared-types`.
 */
export const CONFIG = {
  // ─── LLM / modèles ───────────────────────────────────────────
  ollamaBaseUrl: envString('OLLAMA_URL', OLLAMA_DEFAULT_URL),
  ollamaKeepAlive: envString('OLLAMA_KEEP_ALIVE', '10m'),
  model,
  /** Palier léger optionnel (routage downgrade-only). Absent => pas de routage. */
  modelSmall: process.env['CATDESK_MODEL_SMALL']?.trim() || undefined,
  visionModel: envString('CATDESK_VISION_MODEL', DEFAULT_VISION_MODEL),
  embedModel: envString('CATDESK_EMBED_MODEL', DEFAULT_EMBED_MODEL),
  /** Extraction de faits : un 3B est trop faible (renvoie []) — modèle principal par défaut. */
  extractModel: envString('CATDESK_EXTRACT_MODEL', model),
  /** Appliqué à TOUT appel du modèle de chat : une autre valeur le fait recharger. */
  numCtx: envNumber('CATDESK_NUM_CTX', 8192),
  maxTokens: envNumber('CATDESK_MAX_TOKENS', 1024),
  /**
   * Silence exigé après le dernier échange avant que le travail de fond
   * (extraction de faits, compaction, digests) ne prenne le GPU — voir
   * LlmScheduler. Assez long pour couvrir la lecture d'une réponse.
   */
  backgroundQuietMs: envNumber('CATDESK_BACKGROUND_QUIET_MS', 90_000),
  // 10 (et non 14) : chaque schéma d'outil coûte des tokens de prompt à CHAQUE
  // itération — mesuré trop lent sur RX 6700 avec 14 (réponses > 1 min).
  toolLimit: envNumber('CATDESK_TOOL_LIMIT', 10),
  /**
   * Profil d'outils du chat : 'research' (défaut) recentre le bot sur les
   * articles/dailys et la recherche générale (pas d'outils dev/infra).
   * CATDESK_TOOL_PROFILE=full pour réexposer tout le catalogue.
   */
  toolProfile: (process.env['CATDESK_TOOL_PROFILE'] === 'full' ? 'full' : 'research') as
    | 'research'
    | 'full',

  // ─── Données ─────────────────────────────────────────────────
  dataDir: envString('CATDESK_DATA_DIR', join(process.cwd(), 'data')),

  // ─── Mémoire / caches / daemons ──────────────────────────────
  warmMemory: envFlag('CATDESK_WARM_MEMORY'),
  compaction: envFlag('CATDESK_COMPACTION'),
  playbook: envFlag('CATDESK_PLAYBOOK'),
  evolution: envFlag('CATDESK_EVOLUTION'),
  semanticCache: envFlag('CATDESK_SEMANTIC_CACHE'),
  cacheThreshold: envNumber('CATDESK_CACHE_THRESHOLD', 0.95),
  cacheTtlMs: envNumber('CATDESK_CACHE_TTL_MS', 24 * 60 * 60 * 1000),
  passiveMode: envFlag('CATDESK_PASSIVE_MODE'),
  idleUnloadMs: envNumber('CATDESK_IDLE_UNLOAD_MS', 5 * 60 * 1000),
  spiralThresholdMin: envNumber('CATDESK_SPIRAL_THRESHOLD_MIN', 45),

  // ─── Bourse / presse ─────────────────────────────────────────
  watchlistSeed: (process.env['CATDESK_WATCHLIST'] ?? 'AAPL,MSFT,TSLA').split(','),
  marketIntervalMs: envNumber('CATDESK_MARKET_INTERVAL_MS', 30_000),
  pressHour: envNumber('CATDESK_PRESS_HOUR', 7),
  /** Projet Supabase (lecture des dailys partagées + publication ouverte). */
  supabase: {
    url: envString('SUPABASE_URL', DEFAULT_SUPABASE_URL),
    anonKey: envString('SUPABASE_ANON_KEY', DEFAULT_SUPABASE_ANON_KEY),
  },
} as const;
