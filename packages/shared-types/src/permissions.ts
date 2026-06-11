import type { RiskLevel } from './ipc';

// ─── Permission System ─────────────────────────────────────────

export interface PermissionRequest {
  tool: string;
  args: Record<string, unknown>;
  context?: {
    conversationId?: string;
    activeWindow?: string;
  };
}

export interface PermissionResult {
  granted: boolean;
  reason?: string;
  remember?: boolean;
}

export interface PermissionGrant {
  granted: boolean;
  timestamp: number;
  expiresAt?: number;
}

export interface PermissionConfig {
  safeMode: boolean;
  enabledCritical: string[];
  pathWhitelist: string[];
  tools: Record<string, ToolPermissionConfig>;
}

export interface ToolPermissionConfig {
  name: string;
  description: string;
  riskLevel: RiskLevel;
  enabled: boolean;
  requiresConfirmation: boolean;
}

// ─── Default Permission Config ─────────────────────────────────

export const DEFAULT_PERMISSION_CONFIG: PermissionConfig = {
  safeMode: false,
  enabledCritical: [],
  pathWhitelist: [
    // Windows user home directories by default
    '%USERPROFILE%\\Documents',
    '%USERPROFILE%\\Desktop',
    '%USERPROFILE%\\Downloads',
    '%TEMP%',
  ],
  tools: {
    read_file: { name: 'read_file', description: 'Read file content', riskLevel: 'low', enabled: true, requiresConfirmation: false },
    list_directory: { name: 'list_directory', description: 'List directory', riskLevel: 'low', enabled: true, requiresConfirmation: false },
    capture_screen: { name: 'capture_screen', description: 'Capture screen', riskLevel: 'low', enabled: true, requiresConfirmation: false },
    ocr_region: { name: 'ocr_region', description: 'OCR screen region', riskLevel: 'low', enabled: true, requiresConfirmation: false },
    describe_screen: { name: 'describe_screen', description: 'Describe the screen via a vision model', riskLevel: 'low', enabled: true, requiresConfirmation: false },
    read_clipboard: { name: 'read_clipboard', description: 'Read clipboard', riskLevel: 'low', enabled: true, requiresConfirmation: false },
    search_memory: { name: 'search_memory', description: 'Search memory', riskLevel: 'low', enabled: true, requiresConfirmation: false },
    write_file: { name: 'write_file', description: 'Write file', riskLevel: 'medium', enabled: true, requiresConfirmation: true },
    write_clipboard: { name: 'write_clipboard', description: 'Write clipboard', riskLevel: 'medium', enabled: true, requiresConfirmation: true },
    open_app: { name: 'open_app', description: 'Open application', riskLevel: 'medium', enabled: true, requiresConfirmation: true },
    store_memory: { name: 'store_memory', description: 'Store in memory', riskLevel: 'medium', enabled: true, requiresConfirmation: false },
    analyze_stacktrace: { name: 'analyze_stacktrace', description: 'Analyze stacktrace and extract error info', riskLevel: 'low', enabled: true, requiresConfirmation: false },
    generate_commit_message: { name: 'generate_commit_message', description: 'Read git diff and generate a commit message', riskLevel: 'low', enabled: true, requiresConfirmation: false },
    generate_pr_description: { name: 'generate_pr_description', description: 'Read git log/diff and generate a PR description', riskLevel: 'low', enabled: true, requiresConfirmation: false },
    watch_ci: { name: 'watch_ci', description: 'Poll GitHub Actions workflow runs and surface build errors', riskLevel: 'low', enabled: true, requiresConfirmation: false },
    semantic_search: { name: 'semantic_search', description: 'Search local files by keyword/semantic content similarity', riskLevel: 'low', enabled: true, requiresConfirmation: false },
    read_webpage: { name: 'read_webpage', description: 'Fetch a URL and extract readable text content', riskLevel: 'low', enabled: true, requiresConfirmation: false },
    run_subagent: { name: 'run_subagent', description: 'Spawn an independent sub-agent to complete a task autonomously', riskLevel: 'medium', enabled: true, requiresConfirmation: false },
    run_parallel_agents: { name: 'run_parallel_agents', description: 'Spawn multiple sub-agents running in parallel on independent tasks', riskLevel: 'medium', enabled: true, requiresConfirmation: false },
    transcribe_audio: { name: 'transcribe_audio', description: 'Transcrit un fichier audio localement via Whisper (100% privé, sans cloud)', riskLevel: 'low', enabled: true, requiresConfirmation: false },
    github_list_issues: { name: 'github_list_issues', description: 'List or search GitHub issues for a repository', riskLevel: 'low', enabled: true, requiresConfirmation: false },
    github_get_pr: { name: 'github_get_pr', description: 'Get pull request details, files changed, and optionally the diff', riskLevel: 'low', enabled: true, requiresConfirmation: false },
    run_command: { name: 'run_command', description: 'Run system command', riskLevel: 'high', enabled: true, requiresConfirmation: true },
    close_window: { name: 'close_window', description: 'Close window', riskLevel: 'high', enabled: true, requiresConfirmation: true },
    send_keys: { name: 'send_keys', description: 'Send keyboard input', riskLevel: 'high', enabled: true, requiresConfirmation: true },
    schedule_task: { name: 'schedule_task', description: 'Planifier une tâche récurrente (sous-agent en arrière-plan)', riskLevel: 'high', enabled: true, requiresConfirmation: true },
    list_scheduled_tasks: { name: 'list_scheduled_tasks', description: 'Lister toutes les tâches planifiées', riskLevel: 'low', enabled: true, requiresConfirmation: false },
    cancel_scheduled_task: { name: 'cancel_scheduled_task', description: 'Annuler/supprimer une tâche planifiée', riskLevel: 'medium', enabled: true, requiresConfirmation: false },
    browser_navigate: { name: 'browser_navigate', description: 'Naviguer vers une URL dans le navigateur headless', riskLevel: 'high', enabled: true, requiresConfirmation: true },
    browser_screenshot: { name: 'browser_screenshot', description: 'Prendre une capture d\'écran de la page actuelle', riskLevel: 'low', enabled: true, requiresConfirmation: false },
    browser_get_text: { name: 'browser_get_text', description: 'Extraire le texte visible de la page', riskLevel: 'low', enabled: true, requiresConfirmation: false },
    browser_click: { name: 'browser_click', description: 'Cliquer sur un élément de la page', riskLevel: 'high', enabled: true, requiresConfirmation: true },
    browser_type: { name: 'browser_type', description: 'Saisir du texte dans un champ de la page', riskLevel: 'high', enabled: true, requiresConfirmation: true },
    browser_close: { name: 'browser_close', description: 'Fermer le navigateur headless', riskLevel: 'low', enabled: true, requiresConfirmation: false },
    delete_file: { name: 'delete_file', description: 'Delete file', riskLevel: 'critical', enabled: false, requiresConfirmation: true },
    run_as_admin: { name: 'run_as_admin', description: 'Elevate privileges', riskLevel: 'critical', enabled: false, requiresConfirmation: true },
  },
};
