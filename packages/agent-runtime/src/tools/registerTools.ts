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
import {
  SearchDailiesTool,
  type LocalDailySource,
  type SharedDailySource,
} from './news/SearchDailiesTool';

/**
 * Profil d'exposition des outils au chat :
 * - 'research' (défaut) : bot recentré articles/dailys + recherche générale —
 *   les outils de développement et d'infra ne sont pas enregistrés.
 * - 'full' : tout le catalogue (CATDESK_TOOL_PROFILE=full pour revenir en arrière).
 * Les permissions (DEFAULT_PERMISSION_CONFIG) couvrent toujours le catalogue
 * complet : le test de cohérence tourne en profil 'full'.
 */
export type ToolProfile = 'research' | 'full';

/** Outils dev/infra masqués en profil 'research' (« pas de codage »). */
export const RESEARCH_EXCLUDED: ReadonlySet<string> = new Set([
  // Analyse de code
  'analyze_stacktrace',
  'analyze_logs',
  'generate_unit_tests',
  'suggest_refactor',
  'analyze_dependencies',
  // Git / CI
  'generate_commit_message',
  'generate_pr_description',
  'review_diff',
  'summarize_git_log',
  'resolve_conflicts',
  'bisect_guided',
  'watch_ci',
  // Productivité dev
  'detect_spiral',
  'generate_standup',
  'analyze_code_style',
  'load_project_context',
  // Infra
  'docker_ps',
  'docker_control',
  'run_sqlite',
  'query_database',
  'audit_env',
  'inspect_port',
  'kill_process',
  // GitHub
  'github_list_issues',
  'github_get_pr',
]);

export interface CoreToolDeps {
  llm: OllamaClient;
  vectorStore: VectorStore;
  market: MarketService;
  /** Dailys locales (« Mes journaux ») lues par search_dailies. */
  localDailies: LocalDailySource;
  /** Dailys partagées (Supabase, lecture anonyme) lues par search_dailies. */
  sharedDailies: SharedDailySource;
  /** Modèle principal (post_tech_news_discord rédige les embeds avec). */
  defaultModel: string;
  /** Modèle vision pour describe_screen (minicpm-v — PAS llava, cf. SUIVI). */
  visionModel: string;
}

/** Tous les outils sans dépendance sur l'orchestrateur, filtrés par profil. */
export function registerCoreTools(
  tools: ToolRegistry,
  deps: CoreToolDeps,
  profile: ToolProfile = 'full',
): void {
  const { llm, vectorStore, market, localDailies, sharedDailies, defaultModel, visionModel } = deps;
  const register = (tool: Parameters<ToolRegistry['register']>[0]): void => {
    if (profile === 'research' && RESEARCH_EXCLUDED.has(tool.name)) return;
    tools.register(tool);
  };

  // Filesystem / système / infra
  register(new ReadFileTool());
  register(new ListDirTool());
  register(new WriteFileTool());
  register(new RunCommandTool());
  register(new OpenAppTool());
  register(new AuditEnvTool());
  register(new InspectPortTool());
  register(new KillProcessTool());
  register(new DockerPsTool());
  register(new DockerControlTool());
  register(new RunSqliteTool());
  register(new QueryDatabaseTool());

  // Presse-papiers / mémoire
  register(new ReadClipboardTool());
  register(new WriteClipboardTool());
  register(new SearchMemoryTool(vectorStore));
  register(new StoreMemoryTool(vectorStore));

  // Analyse / git / productivité
  register(new AnalyzeStacktraceTool());
  register(new AnalyzeLogsTool());
  register(new GenerateUnitTestsTool());
  register(new SuggestRefactorTool());
  register(new AnalyzeDependenciesTool());
  register(new GitCommitTool());
  register(new GitPrTool());
  register(new ReviewDiffTool());
  register(new SummarizeGitLogTool());
  register(new ResolveConflictsTool());
  register(new BisectGuidedTool());
  register(new DetectSpiralTool());
  register(new GenerateStandupTool());
  register(new AnalyzeCodeStyleTool());
  register(new LoadProjectContextTool());
  register(new WatchCITool());
  register(new SemanticSearchTool());

  // Web / presse / connecteurs
  register(new ReadWebpageTool());
  register(new FetchTechNewsTool());
  register(new SearchDailiesTool(localDailies, sharedDailies));
  register(new PostTechNewsDiscordTool(llm, defaultModel));
  register(new ObsidianNotesTool());
  register(new NotionSearchTool());
  register(new SendWebhookMessageTool());
  register(new CallApiTool());
  register(new ReadEmailTool());
  register(new GitHubIssuesTool());
  register(new GitHubPRTool());

  // Écran / audio / fichiers
  register(new CaptureScreenTool());
  register(new OcrRegionTool());
  register(new DescribeScreenTool(llm, visionModel));
  register(new TranscribeAudioTool());
  register(new ParseDocumentTool());
  register(new AnalyzeDataTool());
  register(new ExportDocumentTool());
  register(new ReadCalendarTool());

  // Bourse
  register(new GetMarketTool(market));
  register(new AddToWatchlistTool(market));
  register(new RemoveFromWatchlistTool(market));
  register(new SetFormulaTool(market));
  register(new RemoveFormulaTool(market));

  // Navigateur headless (playwright-core, lazy-launch)
  register(new BrowserNavigateTool());
  register(new BrowserScreenshotTool());
  register(new BrowserGetTextTool());
  register(new BrowserClickTool());
  register(new BrowserTypeTool());
  register(new BrowserCloseTool());
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
