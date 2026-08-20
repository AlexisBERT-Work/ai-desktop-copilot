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
    read_file: {
      name: 'read_file',
      description: 'Read file content',
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    list_directory: {
      name: 'list_directory',
      description: 'List directory',
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    capture_screen: {
      name: 'capture_screen',
      description: 'Capture screen',
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    ocr_region: {
      name: 'ocr_region',
      description: 'OCR screen region',
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    describe_screen: {
      name: 'describe_screen',
      description: 'Describe the screen via a vision model',
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    read_clipboard: {
      name: 'read_clipboard',
      description: 'Read clipboard',
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    search_memory: {
      name: 'search_memory',
      description: 'Search memory',
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    write_file: {
      name: 'write_file',
      description: 'Write file',
      riskLevel: 'medium',
      enabled: true,
      requiresConfirmation: true,
    },
    write_clipboard: {
      name: 'write_clipboard',
      description: 'Write clipboard',
      riskLevel: 'medium',
      enabled: true,
      requiresConfirmation: true,
    },
    open_app: {
      name: 'open_app',
      description: 'Open application',
      riskLevel: 'high',
      enabled: true,
      requiresConfirmation: true,
    },
    store_memory: {
      name: 'store_memory',
      description: 'Store in memory',
      riskLevel: 'medium',
      enabled: true,
      requiresConfirmation: false,
    },
    load_skill: {
      name: 'load_skill',
      description: 'Load the detailed procedure of an available skill (local Markdown, read-only)',
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    analyze_stacktrace: {
      name: 'analyze_stacktrace',
      description: 'Analyze stacktrace and extract error info',
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    analyze_logs: {
      name: 'analyze_logs',
      description:
        'Analyse un fichier de log local (niveaux, erreurs regroupées, plage temporelle). Lecture seule, 100% local',
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    generate_commit_message: {
      name: 'generate_commit_message',
      description: 'Read git diff and generate a commit message',
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    generate_pr_description: {
      name: 'generate_pr_description',
      description: 'Read git log/diff and generate a PR description',
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    generate_unit_tests: {
      name: 'generate_unit_tests',
      description: 'Detect test framework and scaffold unit tests for a source file',
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    suggest_refactor: {
      name: 'suggest_refactor',
      description:
        'Detect refactoring opportunities (long functions, duplication, complexity) in a source file',
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    review_diff: {
      name: 'review_diff',
      description:
        'Review a git diff and surface likely issues (secrets, debug code, risky patterns)',
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    analyze_dependencies: {
      name: 'analyze_dependencies',
      description:
        'Parse package.json/Cargo.toml/requirements.txt and flag outdated or risky dependencies',
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    watch_ci: {
      name: 'watch_ci',
      description: 'Poll GitHub Actions workflow runs and surface build errors',
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    bisect_guided: {
      name: 'bisect_guided',
      description:
        'Plan a git bisect: count suspect commits, pick the next to test, and emit manual/automated commands',
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    detect_spiral: {
      name: 'detect_spiral',
      description:
        'Detect when the user is stuck looping on the same problem and suggest a break/new approach',
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    generate_standup: {
      name: 'generate_standup',
      description: 'Draft a daily standup (yesterday/today/blockers) from recent git activity',
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    summarize_git_log: {
      name: 'summarize_git_log',
      description: 'Summarize git history grouped by type/author/area over a time window or path',
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    resolve_conflicts: {
      name: 'resolve_conflicts',
      description: 'Parse merge-conflicted files into ours/theirs blocks to propose a resolution',
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    load_project_context: {
      name: 'load_project_context',
      description:
        'Profile a project on open: stack, scripts, structure, entry points, README summary',
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    analyze_code_style: {
      name: 'analyze_code_style',
      description:
        'Infer code-style conventions (indentation, quotes, semicolons, naming) from sampled files',
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    semantic_search: {
      name: 'semantic_search',
      description: 'Search local files by keyword/semantic content similarity',
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    read_webpage: {
      name: 'read_webpage',
      description: 'Fetch a URL and extract readable text content',
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    fetch_tech_news: {
      name: 'fetch_tech_news',
      description:
        'Aggregate daily tech headlines from Hacker News, The Verge, TechCrunch, DEV.to and more',
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    search_dailies: {
      name: 'search_dailies',
      description:
        'Search and read the generated press-review dailies (local + shared) to answer questions about articles',
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    post_tech_news_discord: {
      name: 'post_tech_news_discord',
      description:
        'Fetch the daily tech news and post them as rich embeds to a pre-configured Discord webhook',
      riskLevel: 'medium',
      enabled: true,
      requiresConfirmation: false,
    },
    obsidian_notes: {
      name: 'obsidian_notes',
      description: 'Search and read notes in a local Obsidian vault',
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    notion_search: {
      name: 'notion_search',
      description: 'Search Notion pages/databases and read page content via the Notion API',
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    send_webhook_message: {
      name: 'send_webhook_message',
      description: 'Post a message to a Discord/Slack incoming webhook (outward-facing)',
      riskLevel: 'high',
      enabled: true,
      requiresConfirmation: true,
    },
    call_api: {
      name: 'call_api',
      description:
        'Make an HTTP/JSON request to a REST API (GET auto; write methods need confirmation)',
      riskLevel: 'high',
      enabled: true,
      requiresConfirmation: true,
    },
    read_email: {
      name: 'read_email',
      description:
        'Read a mailbox over IMAP (read-only): list recent messages or fetch one by UID. Outward network connector with credentials',
      riskLevel: 'high',
      enabled: true,
      requiresConfirmation: true,
    },
    run_subagent: {
      name: 'run_subagent',
      description: 'Spawn an independent sub-agent to complete a task autonomously',
      riskLevel: 'medium',
      enabled: true,
      requiresConfirmation: false,
    },
    run_parallel_agents: {
      name: 'run_parallel_agents',
      description: 'Spawn multiple sub-agents running in parallel on independent tasks',
      riskLevel: 'medium',
      enabled: true,
      requiresConfirmation: false,
    },
    transcribe_audio: {
      name: 'transcribe_audio',
      description: 'Transcrit un fichier audio localement via Whisper (100% privé, sans cloud)',
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    parse_document: {
      name: 'parse_document',
      description:
        "Extrait le texte et les métadonnées d'un document local PDF/Word/CSV (100% local, sans cloud)",
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    analyze_data: {
      name: 'analyze_data',
      description:
        'Analyse un tableau local CSV/Excel via pandas (profil + stats ou agrégation group_by). 100% local',
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    export_document: {
      name: 'export_document',
      description:
        'Génère un document local (PDF/Word/HTML/Markdown) depuis du texte/Markdown. Écrit sur le disque',
      riskLevel: 'medium',
      enabled: true,
      requiresConfirmation: true,
    },
    read_calendar: {
      name: 'read_calendar',
      description:
        'Lit un calendrier .ics local et liste les événements (récurrences développées) sur une fenêtre de dates. 100% local',
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    get_market: {
      name: 'get_market',
      description:
        "Lit l'instantané bourse courant (cotations + formules calculées). Rafraîchit la watchlist",
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    add_to_watchlist: {
      name: 'add_to_watchlist',
      description: 'Ajoute un symbole à la watchlist bourse suivie en direct',
      riskLevel: 'medium',
      enabled: true,
      requiresConfirmation: false,
    },
    remove_from_watchlist: {
      name: 'remove_from_watchlist',
      description: 'Retire un symbole de la watchlist bourse',
      riskLevel: 'medium',
      enabled: true,
      requiresConfirmation: false,
    },
    set_formula: {
      name: 'set_formula',
      description:
        'Crée ou modifie une formule mathématique recalculée en direct sur les cotations',
      riskLevel: 'medium',
      enabled: true,
      requiresConfirmation: false,
    },
    remove_formula: {
      name: 'remove_formula',
      description: 'Supprime une formule de la watchlist bourse',
      riskLevel: 'medium',
      enabled: true,
      requiresConfirmation: false,
    },
    github_list_issues: {
      name: 'github_list_issues',
      description: 'List or search GitHub issues for a repository',
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    github_get_pr: {
      name: 'github_get_pr',
      description: 'Get pull request details, files changed, and optionally the diff',
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    docker_ps: {
      name: 'docker_ps',
      description: "List Docker containers and optionally tail a container's logs",
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    docker_control: {
      name: 'docker_control',
      description: 'Start/stop/restart a container or compose up/down a project',
      riskLevel: 'high',
      enabled: true,
      requiresConfirmation: true,
    },
    run_sqlite: {
      name: 'run_sqlite',
      description: 'Run SQL against a local SQLite database (read-only by default)',
      riskLevel: 'medium',
      enabled: true,
      requiresConfirmation: false,
    },
    query_database: {
      name: 'query_database',
      description:
        'Run SQL against a Postgres or MySQL/MariaDB database (read-only by default, DB-level READ ONLY transaction)',
      riskLevel: 'medium',
      enabled: true,
      requiresConfirmation: false,
    },
    audit_env: {
      name: 'audit_env',
      description:
        'Compare .env against .env.example and flag missing keys, secrets and empty values',
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    inspect_port: {
      name: 'inspect_port',
      description: 'List listening TCP ports and the processes bound to them',
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    kill_process: {
      name: 'kill_process',
      description: 'Terminate a process by PID',
      riskLevel: 'high',
      enabled: true,
      requiresConfirmation: true,
    },
    run_command: {
      name: 'run_command',
      description: 'Run system command',
      riskLevel: 'high',
      enabled: true,
      requiresConfirmation: true,
    },
    schedule_task: {
      name: 'schedule_task',
      description: 'Planifier une tâche récurrente (sous-agent en arrière-plan)',
      riskLevel: 'high',
      enabled: true,
      requiresConfirmation: true,
    },
    list_scheduled_tasks: {
      name: 'list_scheduled_tasks',
      description: 'Lister toutes les tâches planifiées',
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    cancel_scheduled_task: {
      name: 'cancel_scheduled_task',
      description: 'Annuler/supprimer une tâche planifiée',
      riskLevel: 'medium',
      enabled: true,
      requiresConfirmation: false,
    },
    browser_navigate: {
      name: 'browser_navigate',
      description: 'Naviguer vers une URL dans le navigateur headless',
      riskLevel: 'high',
      enabled: true,
      requiresConfirmation: true,
    },
    browser_screenshot: {
      name: 'browser_screenshot',
      description: "Prendre une capture d'écran de la page actuelle",
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    browser_get_text: {
      name: 'browser_get_text',
      description: 'Extraire le texte visible de la page',
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    browser_click: {
      name: 'browser_click',
      description: 'Cliquer sur un élément de la page',
      riskLevel: 'high',
      enabled: true,
      requiresConfirmation: true,
    },
    browser_type: {
      name: 'browser_type',
      description: 'Saisir du texte dans un champ de la page',
      riskLevel: 'high',
      enabled: true,
      requiresConfirmation: true,
    },
    browser_close: {
      name: 'browser_close',
      description: 'Fermer le navigateur headless',
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    // NB : ne déclarer ici que des outils réellement enregistrés dans
    // agent-runtime — registerTools.test.ts refuse toute entrée orpheline.
  },
};
