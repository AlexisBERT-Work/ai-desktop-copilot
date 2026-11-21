/**
 * CatDesk — Agent Runtime Sidecar
 * Communicates with Tauri Rust core via JSON-RPC 2.0 over stdin/stdout.
 *
 * Ce fichier ne fait qu'ASSEMBLER : chaque section crée ses services, inscrit
 * leur arrêt dans le `Lifecycle`, et passe aux suivantes ce dont elles ont
 * besoin. La logique vit dans les modules.
 */

// Premier import : charge le .env local puis fige la config du runtime.
import { CONFIG } from './config';
import { RPC_NOTIFICATIONS } from '@catdesk/shared-types';
import { createLogger } from './logger';
import { Lifecycle } from './lifecycle';
import { StdinBridge } from './ipc/StdinBridge';
import { stdoutNotifier } from './ipc/Notifier';
import { AgentOrchestrator } from './AgentOrchestrator';
import { ToolRegistry } from './ToolRegistry';
import { PermissionEngine } from './permissions/PermissionEngine';
import { ContextManager } from './ContextManager';
import { AuditLogger } from './AuditLogger';
import { ActivityTracker } from './ActivityTracker';
import { SpiralMonitor } from './SpiralMonitor';
import { SubAgentRunner } from './SubAgentRunner';
import { CronScheduler } from './CronScheduler';
import { OllamaClient } from './llm/OllamaClient';
import { IdleUnloader } from './llm/IdleUnloader';
import { LlmScheduler } from './llm/LlmScheduler';
import { Planner } from './llm/Planner';
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
import { registerCoreTools, registerAutomationTools } from './tools/registerTools';
import { MarketService } from './market/MarketService';
import { MarketPoller } from './market/MarketPoller';
import { MarketHistoryStore } from './market/MarketHistoryStore';
import { PressDigestScheduler } from './news/PressDigestScheduler';
import { readPressDigestConfig } from './news/pressConfig';
import { LocalPressFeedStore } from './news/LocalPressFeedStore';
import { LocalDailyStore } from './news/LocalDailyStore';
import { SharedDailyReader } from './news/SharedDailyReader';
import { LocalPressScheduler } from './news/LocalPressScheduler';
import { BrowserManager } from './lib/browserManager';
import { OcrSidecarClient } from './lib/ocrSidecar';

const log = createLogger('runtime:main');

/** Plafond absolu de l'arrêt : au-delà, on sort quoi qu'il reste. */
const SHUTDOWN_HARD_LIMIT_MS = 10_000;

async function main(): Promise<void> {
  log.info('CatDesk Agent Runtime starting', { pid: process.pid, node: process.version });
  const lifecycle = new Lifecycle();

  // Processus enfants lancés à la demande par les outils (navigateur
  // headless, sidecar OCR) : inscrits en premier, donc fermés en dernier.
  lifecycle.onShutdown('ocr-sidecar', () => OcrSidecarClient.get().shutdown());
  lifecycle.onShutdown('browser', () => BrowserManager.get().close());

  // ─── LLM ───────────────────────────────────────────────────
  // Priorité GPU : les questions de l'utilisateur passent devant le travail de
  // fond (faits, compaction, digests), qui attend le calme et cède la place.
  const scheduler = new LlmScheduler({ quietMs: CONFIG.backgroundQuietMs });
  const llm = new OllamaClient({
    baseUrl: CONFIG.ollamaBaseUrl,
    keepAlive: CONFIG.ollamaKeepAlive,
    // Une seule fenêtre de contexte pour tous les appels : en changer recharge le modèle.
    numCtx: CONFIG.numCtx,
    scheduler,
  });
  log.info('Ollama status', { available: await llm.isAvailable() });

  // ─── Mémoire ───────────────────────────────────────────────
  const db = new ConversationStore();
  await db.initialize();
  lifecycle.onShutdown('conversations', () => db.close());

  // Embeddings via Ollama (nomic-embed-text) quand disponible, repli mots-clés sinon.
  const vectorStore = new VectorStore(llm);
  await vectorStore.initialize();

  // Warm memory : faits/préférences structurés sur l'utilisateur, alimentés en
  // tâche de fond. Désactivable via CATDESK_WARM_MEMORY=0.
  const warmStore = CONFIG.warmMemory ? new WarmMemoryStore() : undefined;
  if (warmStore) {
    await warmStore.initialize();
    lifecycle.onShutdown('warm-memory', () => warmStore.close());
  }

  // Playbook : mémoire de stratégie par type de tâche (CATDESK_PLAYBOOK=0).
  const playbook = CONFIG.playbook ? new PlaybookStore() : undefined;
  if (playbook) {
    await playbook.initialize();
    lifecycle.onShutdown('playbook', () => playbook.close());
  }

  // Cache sémantique des réponses (CATDESK_SEMANTIC_CACHE=0) ; seuil/TTL via
  // CATDESK_CACHE_THRESHOLD / CATDESK_CACHE_TTL_MS.
  const cache = CONFIG.semanticCache
    ? new SemanticCache(llm, { threshold: CONFIG.cacheThreshold, ttlMs: CONFIG.cacheTtlMs })
    : undefined;
  cache?.initialize();

  // ─── Bourse ────────────────────────────────────────────────
  // Créée avant le registre : les outils bourse en dépendent. Historique en
  // SQLite (B6) ; un échec n'est pas fatal, le marché reste en mémoire.
  const market = new MarketService([...CONFIG.watchlistSeed]);
  try {
    const marketHistory = new MarketHistoryStore();
    await marketHistory.initialize();
    market.attachHistoryStore(marketHistory);
    lifecycle.onShutdown('market-history', () => marketHistory.close());
  } catch (err) {
    log.warn('MarketHistoryStore indisponible (historique en mémoire seulement)', {
      error: String(err),
    });
  }

  // ─── Dailys (lues par search_dailies) ──────────────────────
  const localFeeds = new LocalPressFeedStore(CONFIG.dataDir);
  const localDailies = new LocalDailyStore(CONFIG.dataDir);
  const sharedDailies = new SharedDailyReader(CONFIG.supabase);

  // ─── Outils ────────────────────────────────────────────────
  const tools = new ToolRegistry();
  registerCoreTools(
    tools,
    {
      llm,
      vectorStore,
      market,
      localDailies,
      sharedDailies,
      defaultModel: CONFIG.model,
      visionModel: CONFIG.visionModel,
    },
    // 'research' (défaut) : bot recentré articles + recherche, sans outils
    // dev/infra. CATDESK_TOOL_PROFILE=full pour tout réexposer.
    CONFIG.toolProfile,
  );

  // ─── Agent ─────────────────────────────────────────────────
  // Mode passif : décharge le modèle de la VRAM après inactivité, pour rendre
  // le GPU aux autres applis (CATDESK_PASSIVE_MODE=0, CATDESK_IDLE_UNLOAD_MS).
  const idleUnloader = new IdleUnloader(llm, {
    enabled: CONFIG.passiveMode,
    idleMs: CONFIG.idleUnloadMs,
  });
  lifecycle.onShutdown('unload-model', () => idleUnloader.unloadNow());

  const activity = new ActivityTracker();
  const orchestrator = new AgentOrchestrator({
    llm,
    tools,
    permissions: new PermissionEngine(),
    context: new ContextManager(db, vectorStore, warmStore),
    audit: new AuditLogger(),
    // Palier léger optionnel (CATDESK_MODEL_SMALL) : rétrogradation des tâches triviales.
    smallModel: CONFIG.modelSmall,
    planner: new Planner(llm),
    activity,
    idleUnloader,
    // Extraction de faits et compaction : modèle capable requis (config.extractModel).
    factExtractor: warmStore ? new FactExtractor(llm, CONFIG.extractModel, warmStore) : undefined,
    compactor: CONFIG.compaction
      ? new Compactor(db, new ConversationSummarizer(llm, CONFIG.extractModel))
      : undefined,
    playbook,
    cache,
    scheduler,
  });
  // Après du travail de fond, le cache d'Ollama contient SON prompt : on y
  // remet le début fixe des requêtes de chat avant la prochaine question.
  scheduler.setPrimer(signal => orchestrator.primeCache(signal));

  // Sous-agents et cron référencent l'orchestrateur : outils enregistrés après lui.
  const subAgentRunner = new SubAgentRunner(orchestrator, tools, CONFIG.model);
  const cron = new CronScheduler(db, subAgentRunner);
  await cron.initialize();
  lifecycle.onShutdown('cron', () => cron.shutdown());
  registerAutomationTools(tools, subAgentRunner, cron);
  log.info('Tools registered', { profile: CONFIG.toolProfile, tools: tools.listNames() });

  // ─── Démons de fond ────────────────────────────────────────
  const marketPoller = new MarketPoller(market, CONFIG.marketIntervalMs);
  marketPoller.start();
  lifecycle.onShutdown('market-poller', () => marketPoller.stop());

  // Consolidation déterministe de la mémoire warm (doublons, faits périmés).
  if (warmStore) {
    const consolidator = new MemoryConsolidator(warmStore);
    consolidator.start();
    lifecycle.onShutdown('memory-consolidator', () => consolidator.stop());
  }

  // Évolution (§8) : rapport de PROPOSITIONS tiré du playbook, jamais appliqué
  // d'office (CATDESK_EVOLUTION=0).
  if (playbook && CONFIG.evolution) {
    const evolution = new EvolutionDaemon(playbook);
    evolution.start();
    lifecycle.onShutdown('evolution', () => evolution.stop());
  }

  // Suggestion proactive quand l'utilisateur boucle sur le même problème.
  const spiralMonitor = new SpiralMonitor(activity, stdoutNotifier, {
    thresholdMinutes: CONFIG.spiralThresholdMin,
  });
  spiralMonitor.start();
  lifecycle.onShutdown('spiral-monitor', () => spiralMonitor.stop());

  // Inscrit AVANT les planificateurs de presse, donc arrêté APRÈS eux : ils
  // sont déjà marqués arrêtés quand leurs appels LLM sont annulés, et ne
  // publient pas les replis dégradés qui en résultent.
  lifecycle.onShutdown('llm-scheduler', () => scheduler.dispose());

  // ─── Revue de presse partagée (tout poste, sauf CATDESK_PRESS_DIGEST=0) ──
  const pressCfg = readPressDigestConfig(process.env, CONFIG.supabase, CONFIG.pressHour);
  const pressScheduler =
    pressCfg !== null ? new PressDigestScheduler(llm, CONFIG.model, pressCfg) : null;
  if (pressScheduler) {
    pressScheduler.start();
    lifecycle.onShutdown('press-digest', () => pressScheduler.stop());
  }

  // ─── Journaux personnalisés LOCAUX (tout utilisateur) ──────
  const localPress = new LocalPressScheduler(
    llm,
    CONFIG.model,
    localFeeds,
    localDailies,
    CONFIG.pressHour,
    dailies => stdoutNotifier(RPC_NOTIFICATIONS.dailiesLocal, { dailies }),
    status => stdoutNotifier(RPC_NOTIFICATIONS.pressLocalProgress, { status }),
  );
  localPress.start();
  lifecycle.onShutdown('local-press', () => localPress.stop());

  // ─── Arrêt ─────────────────────────────────────────────────
  const shutdown = (reason: string): void => {
    setTimeout(() => process.exit(0), SHUTDOWN_HARD_LIMIT_MS).unref();
    void lifecycle.shutdown(reason).finally(() => process.exit(0));
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('uncaughtException', err => {
    log.error('Uncaught exception', { message: err.message, stack: err.stack });
  });
  process.on('unhandledRejection', reason => {
    log.error('Unhandled rejection', { reason: String(reason) });
  });

  // ─── IPC ───────────────────────────────────────────────────
  const bridge = new StdinBridge({
    orchestrator,
    // L'UI ouvre le chat : charger le modèle et lire le prompt fixe pendant la saisie.
    warmup: (model, conversationId) => orchestrator.warmupForUser(model, conversationId),
    setMarketConfig: async (symbols, formulas) => {
      market.setWatchlist(symbols);
      market.setFormulas(formulas);
      await marketPoller.refreshNow();
    },
    // Absent seulement si la revue de presse est désactivée → le bridge
    // répond « inactif » sans rien publier.
    ...(pressScheduler
      ? {
          runPressDigest: async () => {
            await pressScheduler.runOnce();
          },
        }
      : {}),
    localPress: {
      listFeeds: () => localFeeds.list(),
      saveFeed: input => localFeeds.save(input),
      deleteFeed: id => localFeeds.delete(id),
      listDailies: () => localDailies.list(),
      // Manuel = force : régénère (remplace) les dailys du jour déjà publiées.
      runNow: () => localPress.runOnce(true),
      getStatus: () => localPress.status,
    },
    // stdin fermé = CatDesk quitte : seul signal fiable sous Windows.
    onClose: () => shutdown('stdin closed'),
  });
  bridge.start();

  // État initial des journaux/dailys locaux — l'UI peut aussi le redemander via
  // `press.local.sync` (les notifications émises avant le chargement de la
  // fenêtre sont perdues).
  stdoutNotifier(RPC_NOTIFICATIONS.pressFeeds, { feeds: localFeeds.list() });
  stdoutNotifier(RPC_NOTIFICATIONS.dailiesLocal, { dailies: localDailies.list() });

  log.info('Agent Runtime ready and listening on stdin');
}

main().catch(err => {
  process.stderr.write(
    JSON.stringify({ ts: new Date().toISOString(), level: 'FATAL', msg: String(err) }) + '\n',
  );
  process.exit(1);
});
