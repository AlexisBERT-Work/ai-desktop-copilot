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
import { Planner } from './llm/Planner';
import { ActivityTracker } from './ActivityTracker';
import { SpiralMonitor } from './SpiralMonitor';
import { stdoutNotifier } from './ipc/Notifier';
import { ConversationStore } from './memory/ConversationStore';
import { VectorStore } from './memory/VectorStore';
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
import { GitHubIssuesTool } from './tools/github/GitHubIssuesTool';
import { GitHubPRTool } from './tools/github/GitHubPRTool';
import { CaptureScreenTool } from './tools/screen/CaptureScreenTool';
import { OcrRegionTool } from './tools/screen/OcrRegionTool';
import { DescribeScreenTool } from './tools/screen/DescribeScreenTool';
import { TranscribeAudioTool } from './tools/audio/TranscribeAudioTool';
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
import { BrowserManager } from './lib/browserManager';
import { OcrSidecarClient } from './lib/ocrSidecar';

const log = createLogger('runtime:main');

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

  const audit = new AuditLogger();
  const permissions = new PermissionEngine();
  const context = new ContextManager(db, vectorStore);

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
  tools.register(new PostTechNewsDiscordTool(llm, process.env['CATDESK_MODEL'] ?? 'qwen2.5:7b'));
  tools.register(new ObsidianNotesTool());
  tools.register(new NotionSearchTool());
  tools.register(new SendWebhookMessageTool());
  tools.register(new CallApiTool());
  tools.register(new GitHubIssuesTool());
  tools.register(new GitHubPRTool());
  tools.register(new CaptureScreenTool());
  tools.register(new OcrRegionTool());
  tools.register(new DescribeScreenTool(llm, process.env['CATDESK_VISION_MODEL'] ?? 'llava:7b'));
  tools.register(new TranscribeAudioTool());

  // ─── Agent ─────────────────────────────────────────────────
  // CATDESK_MODEL_SMALL (optionnel) : modèle léger vers lequel rétrograder
  // pour les tâches triviales (gain ressources). Absent => pas de routage.
  const smallModel = process.env['CATDESK_MODEL_SMALL'];
  // Planificateur opt-in (utilisé seulement si la requête a usePlanning=true).
  const planner = new Planner(llm);
  // Suivi d'activité → alimente la détection de spirale en arrière-plan.
  const activity = new ActivityTracker();
  const orchestrator = new AgentOrchestrator(llm, tools, permissions, context, audit, smallModel, planner, activity);

  // ─── Spiral monitor (proactive nudge) ──────────────────────
  // Émet une notification `proactive.suggestion` sur stdout quand l'utilisateur
  // boucle sur le même problème. Le bridge Rust la transforme en event Tauri.
  const spiralMonitor = new SpiralMonitor(activity, stdoutNotifier, {
    thresholdMinutes: Number(process.env['CATDESK_SPIRAL_THRESHOLD_MIN'] ?? 45),
  });
  spiralMonitor.start();

  // ─── Sub-agent tools (need orchestrator reference) ─────────
  const defaultModel = process.env['CATDESK_MODEL'] ?? 'qwen2.5:7b';
  const subAgentRunner = new SubAgentRunner(orchestrator, tools, defaultModel);
  tools.register(new RunSubAgentTool(subAgentRunner));
  tools.register(new RunParallelAgentsTool(subAgentRunner));

  // ─── Cron scheduler (needs SubAgentRunner) ─────────────────
  const cron = new CronScheduler(db, subAgentRunner);
  await cron.initialize();
  tools.register(new ScheduleTaskTool(cron));
  tools.register(new ListScheduledTasksTool(cron));
  tools.register(new CancelScheduledTaskTool(cron));

  // ─── Browser tools (playwright-core, lazy-launch) ──────────
  tools.register(new BrowserNavigateTool());
  tools.register(new BrowserScreenshotTool());
  tools.register(new BrowserGetTextTool());
  tools.register(new BrowserClickTool());
  tools.register(new BrowserTypeTool());
  tools.register(new BrowserCloseTool());

  log.info('Tools registered', { tools: tools.listNames() });

  // ─── IPC Bridge ────────────────────────────────────────────
  const bridge = new StdinBridge(orchestrator);
  bridge.start();

  log.info('Agent Runtime ready and listening on stdin');

  // ─── Graceful shutdown ─────────────────────────────────────
  process.on('SIGTERM', () => {
    log.info('SIGTERM received — shutting down');
    cron.shutdown();
    BrowserManager.get().shutdown();
    OcrSidecarClient.get().shutdown();
    db.close();
    process.exit(0);
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
