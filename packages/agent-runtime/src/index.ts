/**
 * CatDesk — Agent Runtime Sidecar
 * Communicates with Tauri Rust core via JSON-RPC 2.0 over stdin/stdout.
 */

import { StdinBridge } from './ipc/StdinBridge';
import { AgentOrchestrator } from './AgentOrchestrator';
import { ToolRegistry } from './ToolRegistry';
import { PermissionEngine } from './permissions/PermissionEngine';
import { ContextManager } from './ContextManager';
import { AuditLogger } from './AuditLogger';
import { OllamaClient } from './llm/OllamaClient';
import { IdleUnloader } from './llm/IdleUnloader';
import { Planner } from './llm/Planner';
import { ActivityTracker } from './ActivityTracker';
import { SpiralMonitor } from './SpiralMonitor';
import { stdoutNotifier } from './ipc/Notifier';
import { ConversationStore } from './memory/ConversationStore';
import { VectorStore } from './memory/VectorStore';
import { WarmMemoryStore } from './memory/WarmMemoryStore';
import { FactExtractor } from './memory/FactExtractor';
import { MemoryConsolidator } from './memory/MemoryConsolidator';
import { ConversationSummarizer } from './memory/ConversationSummarizer';
import { Compactor } from './memory/Compactor';
import { SemanticCache } from './memory/SemanticCache';
import { PlaybookStore } from './playbook/PlaybookStore';
import { EvolutionDaemon } from './playbook/EvolutionDaemon';
import { RPC_NOTIFICATIONS } from '@catdesk/shared-types';
// Premier import : charge le .env local puis fige la config du runtime.
import { CONFIG, envNumber } from './config';
import { createLogger } from './logger';

// ─── Tools ────────────────────────────────────────────────────
// Enregistrement centralisé (et testé) dans tools/registerTools.ts.
import { registerCoreTools, registerAutomationTools } from './tools/registerTools';
import { MarketService } from './market/MarketService';
import { MarketPoller } from './market/MarketPoller';
import { MarketHistoryStore } from './market/MarketHistoryStore';
import { SubAgentRunner } from './SubAgentRunner';
import { CronScheduler } from './CronScheduler';
import {
  PressDigestScheduler,
  type PressDigestConfig,
  type PressMode,
} from './news/PressDigestScheduler';
import { LocalPressFeedStore } from './news/LocalPressFeedStore';
import { LocalDailyStore } from './news/LocalDailyStore';
import { LocalPressScheduler } from './news/LocalPressScheduler';
import { BrowserManager } from './lib/browserManager';
import { OcrSidecarClient } from './lib/ocrSidecar';

const log = createLogger('runtime:main');

// Sélection de journaux par défaut pour la revue de presse quotidienne
// (finance + généraliste FR + international). Surchargeable via CATDESK_PRESS_SOURCES.
const DEFAULT_PRESS_SOURCES = [
  'latribune',
  'cnbc',
  'lemonde',
  'lefigaro',
  'france24',
  'bbc',
  'guardian',
];

/**
 * Config de la revue de presse auto-publiée (dailys). Renvoie null — donc le
 * planificateur ne démarre PAS — sauf si explicitement activé ET muni des
 * identifiants admin Supabase. Les postes clients n'ont pas ces variables, donc
 * eux ne publient jamais : « tout passe par nous » (le poste de référence).
 */
function readPressMode(v: string | undefined): PressMode {
  return v === 'journal' || v === 'topic' || v === 'both' ? v : 'both';
}

function readPressDigestConfig(): PressDigestConfig | null {
  if (process.env['CATDESK_PRESS_DIGEST'] !== '1') return null;
  const url = process.env['SUPABASE_URL'];
  const anonKey = process.env['SUPABASE_ANON_KEY'];
  const email = process.env['SUPABASE_ADMIN_EMAIL'];
  const password = process.env['SUPABASE_ADMIN_PASSWORD'];
  if (!url || !anonKey || !email || !password) {
    log.warn('CATDESK_PRESS_DIGEST=1 mais config admin Supabase incomplète — désactivé');
    return null;
  }
  const csv = (v: string | undefined, fallback: string[]): string[] =>
    v
      ? v
          .split(',')
          .map(s => s.trim())
          .filter(s => s.length > 0)
      : fallback;
  return {
    sourceIds: csv(process.env['CATDESK_PRESS_SOURCES'], DEFAULT_PRESS_SOURCES),
    topics: csv(process.env['CATDESK_PRESS_TOPICS'], []),
    sinceHours: envNumber('CATDESK_PRESS_SINCE_HOURS', 24),
    perJournalLimit: envNumber('CATDESK_PRESS_LIMIT', 10),
    mode: readPressMode(process.env['CATDESK_PRESS_MODE']),
    topicLimit: envNumber('CATDESK_PRESS_TOPIC_LIMIT', 40),
    synthesis: process.env['CATDESK_PRESS_SYNTHESIS'] !== '0',
    hour: CONFIG.pressHour,
    runOnStart: process.env['CATDESK_PRESS_RUN_ON_START'] === '1',
    supabase: { url, anonKey, email, password },
    // Miroir Discord optionnel : réutilise DISCORD_WEBHOOK_URL par défaut, ou une
    // cible dédiée aux dailys via CATDESK_PRESS_DISCORD_WEBHOOK.
    ...(() => {
      const hook = (
        process.env['CATDESK_PRESS_DISCORD_WEBHOOK'] ??
        process.env['DISCORD_WEBHOOK_URL'] ??
        ''
      ).trim();
      return hook.length > 0 ? { discordWebhook: hook } : {};
    })(),
  };
}

async function main() {
  // Le .env local (secrets de connecteurs) est chargé par l'import de
  // ./config, avant toute lecture d'environnement.
  log.info('CatDesk Agent Runtime starting', { pid: process.pid, node: process.version });

  // ─── Services ──────────────────────────────────────────────
  const db = new ConversationStore();
  await db.initialize();

  const llm = new OllamaClient({
    baseUrl: CONFIG.ollamaBaseUrl,
    keepAlive: CONFIG.ollamaKeepAlive,
  });
  const ollamaOk = await llm.isAvailable();
  log.info('Ollama status', { available: ollamaOk });

  // VectorStore uses Ollama (nomic-embed-text) for embeddings when available.
  const vectorStore = new VectorStore(llm);
  await vectorStore.initialize();

  // Warm memory : faits/préférences structurés sur l'utilisateur, instantanés
  // à interroger, alimentés en tâche de fond par le petit modèle. Désactivable
  // via CATDESK_WARM_MEMORY=0.
  const warmEnabled = CONFIG.warmMemory;
  const warmStore = new WarmMemoryStore();
  if (warmEnabled) await warmStore.initialize();

  const audit = new AuditLogger();
  const permissions = new PermissionEngine();
  const context = new ContextManager(db, vectorStore, warmEnabled ? warmStore : undefined);

  // ─── Market (bourse, P3) ───────────────────────────────────
  // Provider de cotations Yahoo + moteur de formules. Le poller pousse
  // périodiquement `market.update` (stdout → bras Rust → event UI). Watchlist
  // de départ via CATDESK_WATCHLIST, cadence via CATDESK_MARKET_INTERVAL_MS.
  // Créé avant le registre : les outils bourse en dépendent.
  const market = new MarketService([...CONFIG.watchlistSeed]);
  // B6 : historique persisté en SQLite (survit aux redémarrages, base des
  // futures formules glissantes). Échec non-fatal : le marché reste en mémoire.
  try {
    const marketHistory = new MarketHistoryStore();
    await marketHistory.initialize();
    market.attachHistoryStore(marketHistory);
  } catch (err) {
    log.warn('MarketHistoryStore indisponible (historique en mémoire seulement)', {
      error: String(err),
    });
  }

  // ─── Tool Registry ─────────────────────────────────────────
  const defaultModel = CONFIG.model;
  const tools = new ToolRegistry();
  registerCoreTools(tools, {
    llm,
    vectorStore,
    market,
    defaultModel,
    // Vision : minicpm-v — PAS llava ni l'arch 'mllama' (voir SUIVI.md, choix
    // validé sur RX 6700). Override via CATDESK_VISION_MODEL.
    visionModel: CONFIG.visionModel,
  });

  const marketPoller = new MarketPoller(market, CONFIG.marketIntervalMs);
  marketPoller.start();

  // ─── Agent ─────────────────────────────────────────────────
  // CATDESK_MODEL_SMALL (optionnel) : modèle léger vers lequel rétrograder
  // pour les tâches triviales (gain ressources). Absent => pas de routage.
  const smallModel = CONFIG.modelSmall;
  // Planificateur opt-in (utilisé seulement si la requête a usePlanning=true).
  const planner = new Planner(llm);
  // Suivi d'activité → alimente la détection de spirale en arrière-plan.
  const activity = new ActivityTracker();
  // Mode passif : décharge le modèle de la VRAM après une période d'inactivité
  // pour rendre le GPU aux autres applis (jeux, etc.). Désactivable via
  // CATDESK_PASSIVE_MODE=0 ; fenêtre réglable via CATDESK_IDLE_UNLOAD_MS.
  const idleUnloader = new IdleUnloader(llm, {
    enabled: CONFIG.passiveMode,
    idleMs: CONFIG.idleUnloadMs,
  });
  // Extraction des faits warm — modèle capable requis (cf. config.extractModel).
  const factExtractor = warmEnabled
    ? new FactExtractor(llm, CONFIG.extractModel, warmStore)
    : undefined;
  // Compaction : replie l'historique ancien en résumé glissant (long sessions).
  // Utilise le modèle d'extraction (capable) ; désactivable via CATDESK_COMPACTION=0.
  const compactor = CONFIG.compaction
    ? new Compactor(db, new ConversationSummarizer(llm, CONFIG.extractModel))
    : undefined;
  // Playbook : mémoire de stratégie (quelle approche marche par type de tâche).
  // Désactivable via CATDESK_PLAYBOOK=0.
  const playbook = CONFIG.playbook ? new PlaybookStore() : undefined;
  if (playbook) await playbook.initialize();
  // Cache sémantique : sert sans LLM une réponse déjà calculée pour une question
  // équivalente (gros gain de latence). Désactivable via CATDESK_SEMANTIC_CACHE=0.
  // Seuil/TTL réglables via CATDESK_CACHE_THRESHOLD / CATDESK_CACHE_TTL_MS.
  const cache = CONFIG.semanticCache
    ? new SemanticCache(llm, {
        threshold: CONFIG.cacheThreshold,
        ttlMs: CONFIG.cacheTtlMs,
      })
    : undefined;
  if (cache) cache.initialize();
  const orchestrator = new AgentOrchestrator(
    llm,
    tools,
    permissions,
    context,
    audit,
    smallModel,
    planner,
    activity,
    idleUnloader,
    factExtractor,
    compactor,
    playbook,
    cache,
  );

  // Daemon de consolidation : nettoie périodiquement la mémoire warm (fusion des
  // doublons inter-clés, purge des faits périmés et peu fiables). Déterministe,
  // sans LLM — tourne en fond sans déranger.
  const consolidator = warmEnabled ? new MemoryConsolidator(warmStore) : undefined;
  consolidator?.start();

  // Daemon d'évolution (§8) : analyse périodiquement les traces du playbook,
  // repère les échecs récurrents et les approches gagnantes, et écrit un rapport
  // de PROPOSITIONS (evolution-proposals.json) — jamais appliquées d'office :
  // l'humain reste dans la boucle. Désactivable via CATDESK_EVOLUTION=0.
  const evolution = playbook && CONFIG.evolution ? new EvolutionDaemon(playbook) : undefined;
  evolution?.start();

  // ─── Spiral monitor (proactive nudge) ──────────────────────
  // Émet une notification `proactive.suggestion` sur stdout quand l'utilisateur
  // boucle sur le même problème. Le bridge Rust la transforme en event Tauri.
  const spiralMonitor = new SpiralMonitor(activity, stdoutNotifier, {
    thresholdMinutes: CONFIG.spiralThresholdMin,
  });
  spiralMonitor.start();

  // ─── Sub-agent + cron tools (need orchestrator reference) ──
  const subAgentRunner = new SubAgentRunner(orchestrator, tools, defaultModel);
  const cron = new CronScheduler(db, subAgentRunner);
  await cron.initialize();
  registerAutomationTools(tools, subAgentRunner, cron);

  // ─── Revue de presse → dailys (poste de référence uniquement) ──
  // Agrège plusieurs journaux, analyse intra-journal (LLM local) et publie une
  // daily par journal dans Supabase. Inactif sans config admin (cf. ci-dessus).
  const pressCfg = readPressDigestConfig();
  const pressScheduler =
    pressCfg !== null ? new PressDigestScheduler(llm, defaultModel, pressCfg) : null;
  pressScheduler?.start();

  // ─── Journaux personnalisés LOCAUX (tout utilisateur) ──────
  // Chaque poste peut définir ses propres journaux (panneau « Mes journaux »),
  // générés quotidiennement par SON agent et stockés localement — ils viennent
  // s'ajouter aux dailys partagées dans le widget. Aucun rôle admin requis.
  const localFeeds = new LocalPressFeedStore(CONFIG.dataDir);
  const localDailies = new LocalDailyStore(CONFIG.dataDir);
  const localPress = new LocalPressScheduler(
    llm,
    defaultModel,
    localFeeds,
    localDailies,
    CONFIG.pressHour,
    dailies => stdoutNotifier(RPC_NOTIFICATIONS.dailiesLocal, { dailies }),
    status => stdoutNotifier(RPC_NOTIFICATIONS.pressLocalProgress, { status }),
  );
  localPress.start();

  log.info('Tools registered', { tools: tools.listNames() });

  // ─── IPC Bridge ────────────────────────────────────────────
  const bridge = new StdinBridge(
    orchestrator,
    async (symbols, formulas) => {
      market.setWatchlist(symbols);
      market.setFormulas(formulas);
      await marketPoller.refreshNow();
    },
    // « Publier maintenant » (console admin) : lance un run immédiat de la revue
    // de presse. Absent (undefined) sur les postes sans config admin → le bridge
    // répond « inactif » sans rien publier.
    pressScheduler !== null
      ? async () => {
          await pressScheduler.runOnce();
        }
      : undefined,
    {
      listFeeds: () => localFeeds.list(),
      saveFeed: input => localFeeds.save(input),
      deleteFeed: id => localFeeds.delete(id),
      listDailies: () => localDailies.list(),
      // Manuel = force : régénère (remplace) les dailys du jour déjà publiées.
      runNow: () => localPress.runOnce(true),
      getStatus: () => localPress.status,
    },
  );
  bridge.start();

  // État initial des journaux/dailys locaux — l'UI peut aussi le redemander via
  // `press.local.sync` (les notifications émises avant le chargement de la
  // fenêtre sont perdues).
  stdoutNotifier(RPC_NOTIFICATIONS.pressFeeds, { feeds: localFeeds.list() });
  stdoutNotifier(RPC_NOTIFICATIONS.dailiesLocal, { dailies: localDailies.list() });

  log.info('Agent Runtime ready and listening on stdin');

  // ─── Graceful shutdown ─────────────────────────────────────
  process.on('SIGTERM', () => {
    log.info('SIGTERM received — shutting down');
    consolidator?.stop();
    cron.shutdown();
    pressScheduler?.stop();
    marketPoller.stop();
    BrowserManager.get().shutdown();
    OcrSidecarClient.get().shutdown();
    db.close();
    // Mode passif : libère la VRAM en quittant (best-effort, ne bloque pas l'arrêt).
    void idleUnloader.unloadNow().finally(() => process.exit(0));
    setTimeout(() => process.exit(0), 5500).unref();
  });

  process.on('uncaughtException', err => {
    log.error('Uncaught exception', { message: err.message, stack: err.stack });
  });

  process.on('unhandledRejection', reason => {
    log.error('Unhandled rejection', { reason: String(reason) });
  });
}

main().catch(err => {
  process.stderr.write(
    JSON.stringify({ ts: new Date().toISOString(), level: 'FATAL', msg: String(err) }) + '\n',
  );
  process.exit(1);
});
