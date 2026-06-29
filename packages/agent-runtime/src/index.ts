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
import { createLogger } from './logger';

// ─── Tools ────────────────────────────────────────────────────
import { ReadFileTool } from './tools/filesystem/ReadFileTool';
import { ListDirTool } from './tools/filesystem/ListDirTool';
import { RunCommandTool } from './tools/system/RunCommandTool';
import { AuditEnvTool } from './tools/system/AuditEnvTool';
import { InspectPortTool } from './tools/system/InspectPortTool';
import { KillProcessTool } from './tools/system/KillProcessTool';
import { DockerPsTool } from './tools/infra/DockerPsTool';
import { DockerControlTool } from './tools/infra/DockerControlTool';
import { RunSqliteTool } from './tools/infra/RunSqliteTool';
import { QueryDatabaseTool } from './tools/infra/QueryDatabaseTool';
import { ReadClipboardTool } from './tools/clipboard/ReadClipboardTool';
import { SearchMemoryTool } from './tools/memory/SearchMemoryTool';
import { AnalyzeStacktraceTool } from './tools/analysis/AnalyzeStacktraceTool';
import { GenerateUnitTestsTool } from './tools/analysis/GenerateUnitTestsTool';
import { SuggestRefactorTool } from './tools/analysis/SuggestRefactorTool';
import { AnalyzeDependenciesTool } from './tools/analysis/AnalyzeDependenciesTool';
import { GitCommitTool } from './tools/git/GitCommitTool';
import { GitPrTool } from './tools/git/GitPrTool';
import { ReviewDiffTool } from './tools/git/ReviewDiffTool';
import { SummarizeGitLogTool } from './tools/git/SummarizeGitLogTool';
import { ResolveConflictsTool } from './tools/git/ResolveConflictsTool';
import { BisectGuidedTool } from './tools/git/BisectGuidedTool';
import { DetectSpiralTool } from './tools/productivity/DetectSpiralTool';
import { GenerateStandupTool } from './tools/productivity/GenerateStandupTool';
import { AnalyzeCodeStyleTool } from './tools/productivity/AnalyzeCodeStyleTool';
import { LoadProjectContextTool } from './tools/productivity/LoadProjectContextTool';
import { WatchCITool } from './tools/git/WatchCITool';
import { SemanticSearchTool } from './tools/search/SemanticSearchTool';
import { ReadWebpageTool } from './tools/web/ReadWebpageTool';
import { FetchTechNewsTool } from './tools/web/FetchTechNewsTool';
import { PostTechNewsDiscordTool } from './tools/web/PostTechNewsDiscordTool';
import { ObsidianNotesTool } from './tools/connectors/ObsidianNotesTool';
import { NotionSearchTool } from './tools/connectors/NotionSearchTool';
import { SendWebhookMessageTool } from './tools/connectors/SendWebhookMessageTool';
import { CallApiTool } from './tools/connectors/CallApiTool';
import { ReadEmailTool } from './tools/connectors/ReadEmailTool';
import { GitHubIssuesTool } from './tools/github/GitHubIssuesTool';
import { GitHubPRTool } from './tools/github/GitHubPRTool';
import { CaptureScreenTool } from './tools/screen/CaptureScreenTool';
import { OcrRegionTool } from './tools/screen/OcrRegionTool';
import { DescribeScreenTool } from './tools/screen/DescribeScreenTool';
import { TranscribeAudioTool } from './tools/audio/TranscribeAudioTool';
import { ParseDocumentTool } from './tools/files/ParseDocumentTool';
import { AnalyzeDataTool } from './tools/files/AnalyzeDataTool';
import { ExportDocumentTool } from './tools/files/ExportDocumentTool';
import { ReadCalendarTool } from './tools/files/ReadCalendarTool';
import { MarketService } from './market/MarketService';
import { MarketPoller } from './market/MarketPoller';
import { GetMarketTool } from './tools/market/GetMarketTool';
import { AddToWatchlistTool } from './tools/market/AddToWatchlistTool';
import { RemoveFromWatchlistTool } from './tools/market/RemoveFromWatchlistTool';
import { SetFormulaTool } from './tools/market/SetFormulaTool';
import { RemoveFormulaTool } from './tools/market/RemoveFormulaTool';
import { RunSubAgentTool } from './tools/automation/RunSubAgentTool';
import { RunParallelAgentsTool } from './tools/automation/RunParallelAgentsTool';
import { ScheduleTaskTool } from './tools/automation/ScheduleTaskTool';
import { ListScheduledTasksTool } from './tools/automation/ListScheduledTasksTool';
import { CancelScheduledTaskTool } from './tools/automation/CancelScheduledTaskTool';
import { BrowserNavigateTool } from './tools/browser/BrowserNavigateTool';
import { BrowserScreenshotTool } from './tools/browser/BrowserScreenshotTool';
import { BrowserGetTextTool } from './tools/browser/BrowserGetTextTool';
import { BrowserClickTool } from './tools/browser/BrowserClickTool';
import { BrowserTypeTool } from './tools/browser/BrowserTypeTool';
import { BrowserCloseTool } from './tools/browser/BrowserCloseTool';
import { SubAgentRunner } from './SubAgentRunner';
import { CronScheduler } from './CronScheduler';
import { PressDigestScheduler, type PressDigestConfig } from './news/PressDigestScheduler';
import { BrowserManager } from './lib/browserManager';
import { OcrSidecarClient } from './lib/ocrSidecar';

const log = createLogger('runtime:main');

// Sélection de journaux par défaut pour la revue de presse quotidienne
// (finance + généraliste FR + international). Surchargeable via CATDESK_PRESS_SOURCES.
const DEFAULT_PRESS_SOURCES = ['lesechos', 'cnbc', 'lemonde', 'lefigaro', 'france24', 'bbc', 'guardian'];

/**
 * Config de la revue de presse auto-publiée (dailys). Renvoie null — donc le
 * planificateur ne démarre PAS — sauf si explicitement activé ET muni des
 * identifiants admin Supabase. Les postes clients n'ont pas ces variables, donc
 * eux ne publient jamais : « tout passe par nous » (le poste de référence).
 */
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
    v ? v.split(',').map((s) => s.trim()).filter((s) => s.length > 0) : fallback;
  return {
    sourceIds: csv(process.env['CATDESK_PRESS_SOURCES'], DEFAULT_PRESS_SOURCES),
    topics: csv(process.env['CATDESK_PRESS_TOPICS'], []),
    sinceHours: Number(process.env['CATDESK_PRESS_SINCE_HOURS'] ?? 24),
    perJournalLimit: Number(process.env['CATDESK_PRESS_LIMIT'] ?? 6),
    hour: Number(process.env['CATDESK_PRESS_HOUR'] ?? 7),
    supabase: { url, anonKey, email, password },
  };
}

async function main() {
  // Load a local .env (gitignored) for connector secrets — DISCORD_WEBHOOK_URL,
  // GITHUB_TOKEN, NOTION_TOKEN, etc. Falls back silently to the inherited
  // environment when no file is present. loadEnvFile exists on Node ≥20.12.
  try {
    (process as { loadEnvFile?: (path?: string) => void }).loadEnvFile?.();
  } catch { /* no .env file — rely on the inherited environment */ }

  log.info('CatDesk Agent Runtime starting', { pid: process.pid, node: process.version });

  // ─── Services ──────────────────────────────────────────────
  const db = new ConversationStore();
  await db.initialize();

  const llm = new OllamaClient({
    baseUrl: process.env['OLLAMA_URL'] ?? 'http://127.0.0.1:11434',
    keepAlive: process.env['OLLAMA_KEEP_ALIVE'] ?? '10m',
  });
  const ollamaOk = await llm.isAvailable();
  log.info('Ollama status', { available: ollamaOk });

  // VectorStore uses Ollama (nomic-embed-text) for embeddings when available.
  const vectorStore = new VectorStore(llm);
  await vectorStore.initialize();

  // Warm memory : faits/préférences structurés sur l'utilisateur, instantanés
  // à interroger, alimentés en tâche de fond par le petit modèle. Désactivable
  // via CATDESK_WARM_MEMORY=0.
  const warmEnabled = process.env['CATDESK_WARM_MEMORY'] !== '0';
  const warmStore = new WarmMemoryStore();
  if (warmEnabled) await warmStore.initialize();

  const audit = new AuditLogger();
  const permissions = new PermissionEngine();
  const context = new ContextManager(db, vectorStore, warmEnabled ? warmStore : undefined);

  // ─── Tool Registry ─────────────────────────────────────────
  const tools = new ToolRegistry();
  tools.register(new ReadFileTool());
  tools.register(new ListDirTool());
  tools.register(new RunCommandTool());
  tools.register(new AuditEnvTool());
  tools.register(new InspectPortTool());
  tools.register(new KillProcessTool());
  tools.register(new DockerPsTool());
  tools.register(new DockerControlTool());
  tools.register(new RunSqliteTool());
  tools.register(new QueryDatabaseTool());
  tools.register(new ReadClipboardTool());
  tools.register(new SearchMemoryTool(vectorStore));
  tools.register(new AnalyzeStacktraceTool());
  tools.register(new GenerateUnitTestsTool());
  tools.register(new SuggestRefactorTool());
  tools.register(new AnalyzeDependenciesTool());
  tools.register(new GitCommitTool());
  tools.register(new GitPrTool());
  tools.register(new ReviewDiffTool());
  tools.register(new SummarizeGitLogTool());
  tools.register(new ResolveConflictsTool());
  tools.register(new BisectGuidedTool());
  tools.register(new DetectSpiralTool());
  tools.register(new GenerateStandupTool());
  tools.register(new AnalyzeCodeStyleTool());
  tools.register(new LoadProjectContextTool());
  tools.register(new WatchCITool());
  tools.register(new SemanticSearchTool());
  tools.register(new ReadWebpageTool());
  tools.register(new FetchTechNewsTool());
  tools.register(new PostTechNewsDiscordTool(llm, process.env['CATDESK_MODEL'] ?? 'qwen3:14b'));
  tools.register(new ObsidianNotesTool());
  tools.register(new NotionSearchTool());
  tools.register(new SendWebhookMessageTool());
  tools.register(new CallApiTool());
  tools.register(new ReadEmailTool());
  tools.register(new GitHubIssuesTool());
  tools.register(new GitHubPRTool());
  tools.register(new CaptureScreenTool());
  tools.register(new OcrRegionTool());
  // Vision model for describe_screen. Must load on this Windows/AMD setup via
  // llama.cpp — NOT the 'mllama' arch (llama3.2-vision fails with "unknown model
  // architecture: 'mllama'"). minicpm-v reads diagrams/charts/UIs accurately and
  // grounded (llava-llama3 hallucinated badly — invented unrelated content).
  // Verified: reads a labelled flowchart's boxes + notes with no hallucination,
  // ~21s on the RX 6700. Override via CATDESK_VISION_MODEL.
  tools.register(new DescribeScreenTool(llm, process.env['CATDESK_VISION_MODEL'] ?? 'minicpm-v'));
  tools.register(new TranscribeAudioTool());
  tools.register(new ParseDocumentTool());
  tools.register(new AnalyzeDataTool());
  tools.register(new ExportDocumentTool());
  tools.register(new ReadCalendarTool());

  // ─── Market (bourse, P3) ───────────────────────────────────
  // Provider de cotations Yahoo + moteur de formules. Le poller pousse
  // périodiquement `market.update` (stdout → bras Rust → event UI). Watchlist
  // de départ via CATDESK_WATCHLIST, cadence via CATDESK_MARKET_INTERVAL_MS.
  const marketSeed = (process.env['CATDESK_WATCHLIST'] ?? 'AAPL,MSFT,TSLA').split(',');
  const market = new MarketService(marketSeed);
  tools.register(new GetMarketTool(market));
  tools.register(new AddToWatchlistTool(market));
  tools.register(new RemoveFromWatchlistTool(market));
  tools.register(new SetFormulaTool(market));
  tools.register(new RemoveFormulaTool(market));
  const marketPoller = new MarketPoller(
    market,
    Number(process.env['CATDESK_MARKET_INTERVAL_MS'] ?? 30_000),
  );
  marketPoller.start();

  // ─── Agent ─────────────────────────────────────────────────
  // CATDESK_MODEL_SMALL (optionnel) : modèle léger vers lequel rétrograder
  // pour les tâches triviales (gain ressources). Absent => pas de routage.
  const smallModel = process.env['CATDESK_MODEL_SMALL'];
  // Planificateur opt-in (utilisé seulement si la requête a usePlanning=true).
  const planner = new Planner(llm);
  // Suivi d'activité → alimente la détection de spirale en arrière-plan.
  const activity = new ActivityTracker();
  // Mode passif : décharge le modèle de la VRAM après une période d'inactivité
  // pour rendre le GPU aux autres applis (jeux, etc.). Désactivable via
  // CATDESK_PASSIVE_MODE=0 ; fenêtre réglable via CATDESK_IDLE_UNLOAD_MS.
  const idleUnloader = new IdleUnloader(llm, {
    enabled: process.env['CATDESK_PASSIVE_MODE'] !== '0',
    idleMs: Number(process.env['CATDESK_IDLE_UNLOAD_MS'] ?? 5 * 60 * 1000),
  });
  // Extraction des faits warm. NB : un 3B est trop faible pour cette tâche
  // (testé : il renvoie []), donc on extrait avec le modèle PRINCIPAL par
  // défaut, indépendamment du petit modèle de routage. Surchargeable via
  // CATDESK_EXTRACT_MODEL (ex. un 14B dédié sur une grosse machine).
  const extractModel = process.env['CATDESK_EXTRACT_MODEL'] ?? process.env['CATDESK_MODEL'] ?? 'qwen3:14b';
  const factExtractor = warmEnabled ? new FactExtractor(llm, extractModel, warmStore) : undefined;
  // Compaction : replie l'historique ancien en résumé glissant (long sessions).
  // Utilise le modèle d'extraction (capable) ; désactivable via CATDESK_COMPACTION=0.
  const compactor = process.env['CATDESK_COMPACTION'] !== '0'
    ? new Compactor(db, new ConversationSummarizer(llm, extractModel))
    : undefined;
  // Playbook : mémoire de stratégie (quelle approche marche par type de tâche).
  // Désactivable via CATDESK_PLAYBOOK=0.
  const playbookEnabled = process.env['CATDESK_PLAYBOOK'] !== '0';
  const playbook = playbookEnabled ? new PlaybookStore() : undefined;
  if (playbook) await playbook.initialize();
  // Cache sémantique : sert sans LLM une réponse déjà calculée pour une question
  // équivalente (gros gain de latence). Désactivable via CATDESK_SEMANTIC_CACHE=0.
  // Seuil/TTL réglables via CATDESK_CACHE_THRESHOLD / CATDESK_CACHE_TTL_MS.
  const cache = process.env['CATDESK_SEMANTIC_CACHE'] !== '0'
    ? new SemanticCache(llm, {
        threshold: Number(process.env['CATDESK_CACHE_THRESHOLD'] ?? 0.95),
        ttlMs: Number(process.env['CATDESK_CACHE_TTL_MS'] ?? 24 * 60 * 60 * 1000),
      })
    : undefined;
  if (cache) cache.initialize();
  const orchestrator = new AgentOrchestrator(llm, tools, permissions, context, audit, smallModel, planner, activity, idleUnloader, factExtractor, compactor, playbook, cache);

  // Daemon de consolidation : nettoie périodiquement la mémoire warm (fusion des
  // doublons inter-clés, purge des faits périmés et peu fiables). Déterministe,
  // sans LLM — tourne en fond sans déranger.
  const consolidator = warmEnabled ? new MemoryConsolidator(warmStore) : undefined;
  consolidator?.start();

  // Daemon d'évolution (§8) : analyse périodiquement les traces du playbook,
  // repère les échecs récurrents et les approches gagnantes, et écrit un rapport
  // de PROPOSITIONS (evolution-proposals.json) — jamais appliquées d'office :
  // l'humain reste dans la boucle. Désactivable via CATDESK_EVOLUTION=0.
  const evolution = playbook && process.env['CATDESK_EVOLUTION'] !== '0'
    ? new EvolutionDaemon(playbook)
    : undefined;
  evolution?.start();

  // ─── Spiral monitor (proactive nudge) ──────────────────────
  // Émet une notification `proactive.suggestion` sur stdout quand l'utilisateur
  // boucle sur le même problème. Le bridge Rust la transforme en event Tauri.
  const spiralMonitor = new SpiralMonitor(activity, stdoutNotifier, {
    thresholdMinutes: Number(process.env['CATDESK_SPIRAL_THRESHOLD_MIN'] ?? 45),
  });
  spiralMonitor.start();

  // ─── Sub-agent tools (need orchestrator reference) ─────────
  const defaultModel = process.env['CATDESK_MODEL'] ?? 'qwen3:14b';
  const subAgentRunner = new SubAgentRunner(orchestrator, tools, defaultModel);
  tools.register(new RunSubAgentTool(subAgentRunner));
  tools.register(new RunParallelAgentsTool(subAgentRunner));

  // ─── Cron scheduler (needs SubAgentRunner) ─────────────────
  const cron = new CronScheduler(db, subAgentRunner);
  await cron.initialize();
  tools.register(new ScheduleTaskTool(cron));
  tools.register(new ListScheduledTasksTool(cron));
  tools.register(new CancelScheduledTaskTool(cron));

  // ─── Revue de presse → dailys (poste de référence uniquement) ──
  // Agrège plusieurs journaux, analyse intra-journal (LLM local) et publie une
  // daily par journal dans Supabase. Inactif sans config admin (cf. ci-dessus).
  const pressCfg = readPressDigestConfig();
  const pressScheduler = pressCfg !== null ? new PressDigestScheduler(llm, defaultModel, pressCfg) : null;
  pressScheduler?.start();

  // ─── Browser tools (playwright-core, lazy-launch) ──────────
  tools.register(new BrowserNavigateTool());
  tools.register(new BrowserScreenshotTool());
  tools.register(new BrowserGetTextTool());
  tools.register(new BrowserClickTool());
  tools.register(new BrowserTypeTool());
  tools.register(new BrowserCloseTool());

  log.info('Tools registered', { tools: tools.listNames() });

  // ─── IPC Bridge ────────────────────────────────────────────
  const bridge = new StdinBridge(orchestrator, async (symbols, formulas) => {
    market.setWatchlist(symbols);
    market.setFormulas(formulas);
    await marketPoller.refreshNow();
  });
  bridge.start();

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

  process.on('unhandledRejection', (reason) => {
    log.error('Unhandled rejection', { reason: String(reason) });
  });
}

main().catch(err => {
  process.stderr.write(JSON.stringify({ ts: new Date().toISOString(), level: 'FATAL', msg: String(err) }) + '\n');
  process.exit(1);
});
