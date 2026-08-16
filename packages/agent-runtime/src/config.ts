import { join } from 'node:path';
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

const model = process.env['CATDESK_MODEL'] ?? 'qwen3:14b';

/**
 * Configuration du runtime, lue une seule fois au démarrage (après le .env).
 * Choix de modèles : voir CLAUDE.md (contraintes VRAM RX 6700 10 Go) —
 * qwen3:14b chat/digests, minicpm-v vision (PAS llava), nomic-embed-text.
 */
export const CONFIG = {
  // ─── LLM / modèles ───────────────────────────────────────────
  ollamaBaseUrl: process.env['OLLAMA_URL'] ?? 'http://127.0.0.1:11434',
  ollamaKeepAlive: process.env['OLLAMA_KEEP_ALIVE'] ?? '10m',
  model,
  /** Palier léger optionnel (routage downgrade-only). Absent => pas de routage. */
  modelSmall: process.env['CATDESK_MODEL_SMALL'],
  visionModel: process.env['CATDESK_VISION_MODEL'] ?? 'minicpm-v',
  embedModel: process.env['CATDESK_EMBED_MODEL'] ?? 'nomic-embed-text',
  /** Extraction de faits : un 3B est trop faible (renvoie []) — modèle principal par défaut. */
  extractModel: process.env['CATDESK_EXTRACT_MODEL'] ?? model,
  numCtx: envNumber('CATDESK_NUM_CTX', 8192),
  maxTokens: envNumber('CATDESK_MAX_TOKENS', 1024),
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
  dataDir: process.env['CATDESK_DATA_DIR'] ?? join(process.cwd(), 'data'),

  /**
   * Annonce des skills dans le system prompt (`nom — description`).
   * **Opt-in, désactivé par défaut** — contrairement aux autres drapeaux, celui-ci
   * ne vaut pas « fonctionnalité en rodage » mais « nuisible sur le modèle du
   * bundle », et c'est mesuré (2026-08-16, `qwen3:14b` + `think:false`, banc de
   * 6 requêtes × 4 formulations) : dès qu'on liste les skills dans le prompt, le
   * modèle tente un appel d'outil malformé qu'Ollama jette — réponse VIDE, aucun
   * outil appelé, sur 2 à 5 requêtes sur 6 selon la formulation. Sans la liste,
   * les mêmes requêtes appellent correctement `search_dailies` (5/6).
   * L'outil `load_skill` lui-même est inoffensif (mesuré séparément : aucune
   * dégradation) et reste donc TOUJOURS enregistré — un skill se charge en le
   * nommant. Seule l'auto-découverte est coupée.
   * `CATDESK_SKILL_INDEX=1` pour réactiver (ex. après changement de modèle).
   * Voir docs/veille/2026-08-16-analyse-repos-externes.md §5.
   */
  skillIndex: process.env['CATDESK_SKILL_INDEX'] === '1',

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
} as const;
