/**
 * Enregistrement centralisé des outils de l'agent.
 *
 * Extrait de `index.ts` pour être instanciable en test : le test de cohérence
 * des métadonnées (registerTools.test.ts) vérifie que chaque outil enregistré
 * correspond exactement à une entrée de DEFAULT_PERMISSION_CONFIG.
 */
import type { ToolRegistry } from '../ToolRegistry';
import type { OllamaClient } from '../llm/OllamaClient';
import type { VectorStore } from '../memory/VectorStore';
import type { MarketService } from '../market/MarketService';
import type { SubAgentRunner } from '../SubAgentRunner';
import type { CronScheduler } from '../CronScheduler';

import { ReadFileTool } from './filesystem/ReadFileTool';
import { ListDirTool } from './filesystem/ListDirTool';
import { WriteFileTool } from './filesystem/WriteFileTool';
import { RunCommandTool } from './system/RunCommandTool';
import { OpenAppTool } from './system/OpenAppTool';
import { AuditEnvTool } from './system/AuditEnvTool';
import { InspectPortTool } from './system/InspectPortTool';
import { KillProcessTool } from './system/KillProcessTool';
import { DockerPsTool } from './infra/DockerPsTool';
import { DockerControlTool } from './infra/DockerControlTool';
import { RunSqliteTool } from './infra/RunSqliteTool';
import { QueryDatabaseTool } from './infra/QueryDatabaseTool';
import { ReadClipboardTool } from './clipboard/ReadClipboardTool';
import { WriteClipboardTool } from './clipboard/WriteClipboardTool';
import { SearchMemoryTool } from './memory/SearchMemoryTool';
import { StoreMemoryTool } from './memory/StoreMemoryTool';
import { AnalyzeStacktraceTool } from './analysis/AnalyzeStacktraceTool';
import { AnalyzeLogsTool } from './analysis/AnalyzeLogsTool';
import { GenerateUnitTestsTool } from './analysis/GenerateUnitTestsTool';
import { SuggestRefactorTool } from './analysis/SuggestRefactorTool';
import { AnalyzeDependenciesTool } from './analysis/AnalyzeDependenciesTool';
import { GitCommitTool } from './git/GitCommitTool';
import { GitPrTool } from './git/GitPrTool';
import { ReviewDiffTool } from './git/ReviewDiffTool';
import { SummarizeGitLogTool } from './git/SummarizeGitLogTool';
import { ResolveConflictsTool } from './git/ResolveConflictsTool';
import { BisectGuidedTool } from './git/BisectGuidedTool';
import { WatchCITool } from './git/WatchCITool';
import { DetectSpiralTool } from './productivity/DetectSpiralTool';
import { GenerateStandupTool } from './productivity/GenerateStandupTool';
import { AnalyzeCodeStyleTool } from './productivity/AnalyzeCodeStyleTool';
import { LoadProjectContextTool } from './productivity/LoadProjectContextTool';
import { SemanticSearchTool } from './search/SemanticSearchTool';
import { ReadWebpageTool } from './web/ReadWebpageTool';
import { FetchTechNewsTool } from './web/FetchTechNewsTool';
import { PostTechNewsDiscordTool } from './web/PostTechNewsDiscordTool';
import { ObsidianNotesTool } from './connectors/ObsidianNotesTool';
import { NotionSearchTool } from './connectors/NotionSearchTool';
import { SendWebhookMessageTool } from './connectors/SendWebhookMessageTool';
import { CallApiTool } from './connectors/CallApiTool';
import { ReadEmailTool } from './connectors/ReadEmailTool';
import { GitHubIssuesTool } from './github/GitHubIssuesTool';
import { GitHubPRTool } from './github/GitHubPRTool';
import { CaptureScreenTool } from './screen/CaptureScreenTool';
import { OcrRegionTool } from './screen/OcrRegionTool';
import { DescribeScreenTool } from './screen/DescribeScreenTool';
import { TranscribeAudioTool } from './audio/TranscribeAudioTool';
import { ParseDocumentTool } from './files/ParseDocumentTool';
import { AnalyzeDataTool } from './files/AnalyzeDataTool';
import { ExportDocumentTool } from './files/ExportDocumentTool';
import { ReadCalendarTool } from './files/ReadCalendarTool';
import { GetMarketTool } from './market/GetMarketTool';
import { AddToWatchlistTool } from './market/AddToWatchlistTool';
import { RemoveFromWatchlistTool } from './market/RemoveFromWatchlistTool';
import { SetFormulaTool } from './market/SetFormulaTool';
import { RemoveFormulaTool } from './market/RemoveFormulaTool';
import { RunSubAgentTool } from './automation/RunSubAgentTool';
import { RunParallelAgentsTool } from './automation/RunParallelAgentsTool';
import { ScheduleTaskTool } from './automation/ScheduleTaskTool';
import { ListScheduledTasksTool } from './automation/ListScheduledTasksTool';
import { CancelScheduledTaskTool } from './automation/CancelScheduledTaskTool';
import { BrowserNavigateTool } from './browser/BrowserNavigateTool';
import { BrowserScreenshotTool } from './browser/BrowserScreenshotTool';
import { BrowserGetTextTool } from './browser/BrowserGetTextTool';
import { BrowserClickTool } from './browser/BrowserClickTool';
import { BrowserTypeTool } from './browser/BrowserTypeTool';
import { BrowserCloseTool } from './browser/BrowserCloseTool';

export interface CoreToolDeps {
  llm: OllamaClient;
  vectorStore: VectorStore;
  market: MarketService;
  /** Modèle principal (post_tech_news_discord rédige les embeds avec). */
  defaultModel: string;
  /** Modèle vision pour describe_screen (minicpm-v — PAS llava, cf. SUIVI). */
  visionModel: string;
}

/** Tous les outils sans dépendance sur l'orchestrateur. */
export function registerCoreTools(tools: ToolRegistry, deps: CoreToolDeps): void {
  const { llm, vectorStore, market, defaultModel, visionModel } = deps;

  // Filesystem / système / infra
  tools.register(new ReadFileTool());
  tools.register(new ListDirTool());
  tools.register(new WriteFileTool());
  tools.register(new RunCommandTool());
  tools.register(new OpenAppTool());
  tools.register(new AuditEnvTool());
  tools.register(new InspectPortTool());
  tools.register(new KillProcessTool());
  tools.register(new DockerPsTool());
  tools.register(new DockerControlTool());
  tools.register(new RunSqliteTool());
  tools.register(new QueryDatabaseTool());

  // Presse-papiers / mémoire
  tools.register(new ReadClipboardTool());
  tools.register(new WriteClipboardTool());
  tools.register(new SearchMemoryTool(vectorStore));
  tools.register(new StoreMemoryTool(vectorStore));

  // Analyse / git / productivité
  tools.register(new AnalyzeStacktraceTool());
  tools.register(new AnalyzeLogsTool());
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

  // Web / connecteurs
  tools.register(new ReadWebpageTool());
  tools.register(new FetchTechNewsTool());
  tools.register(new PostTechNewsDiscordTool(llm, defaultModel));
  tools.register(new ObsidianNotesTool());
  tools.register(new NotionSearchTool());
  tools.register(new SendWebhookMessageTool());
  tools.register(new CallApiTool());
  tools.register(new ReadEmailTool());
  tools.register(new GitHubIssuesTool());
  tools.register(new GitHubPRTool());

  // Écran / audio / fichiers
  tools.register(new CaptureScreenTool());
  tools.register(new OcrRegionTool());
  tools.register(new DescribeScreenTool(llm, visionModel));
  tools.register(new TranscribeAudioTool());
  tools.register(new ParseDocumentTool());
  tools.register(new AnalyzeDataTool());
  tools.register(new ExportDocumentTool());
  tools.register(new ReadCalendarTool());

  // Bourse
  tools.register(new GetMarketTool(market));
  tools.register(new AddToWatchlistTool(market));
  tools.register(new RemoveFromWatchlistTool(market));
  tools.register(new SetFormulaTool(market));
  tools.register(new RemoveFormulaTool(market));

  // Navigateur headless (playwright-core, lazy-launch)
  tools.register(new BrowserNavigateTool());
  tools.register(new BrowserScreenshotTool());
  tools.register(new BrowserGetTextTool());
  tools.register(new BrowserClickTool());
  tools.register(new BrowserTypeTool());
  tools.register(new BrowserCloseTool());
}

/** Outils qui référencent l'orchestrateur (sous-agents) ou le cron. */
export function registerAutomationTools(
  tools: ToolRegistry,
  subAgents: SubAgentRunner,
  cron: CronScheduler,
): void {
  tools.register(new RunSubAgentTool(subAgents));
  tools.register(new RunParallelAgentsTool(subAgents));
  tools.register(new ScheduleTaskTool(cron));
  tools.register(new ListScheduledTasksTool(cron));
  tools.register(new CancelScheduledTaskTool(cron));
}
