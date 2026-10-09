import type { RiskLevel } from './ipc';

// ─── Permission System ─────────────────────────────────────────

/**
 * Délai de réponse à une demande de confirmation. Au-delà, l'agent la traite
 * comme un refus et l'UI ferme le dialogue — une seule valeur pour les deux.
 */
export const PERMISSION_TIMEOUT_MS = 60_000;

export interface PermissionRequest {
  tool: string;
  args: Record<string, unknown>;
  /** Chemins du disque visés, à vérifier contre la liste blanche (BaseTool.pathArgs). */
  paths?: string[];
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
      description: "Lire le contenu d'un fichier",
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    list_directory: {
      name: 'list_directory',
      description: 'Lister un dossier',
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    capture_screen: {
      name: 'capture_screen',
      description: "Capturer l'écran",
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    ocr_region: {
      name: 'ocr_region',
      description: "Lire le texte d'une zone de l'écran (OCR)",
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    describe_screen: {
      name: 'describe_screen',
      description: "Décrire l'écran avec un modèle de vision",
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    read_clipboard: {
      name: 'read_clipboard',
      description: 'Lire le presse-papier',
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    search_memory: {
      name: 'search_memory',
      description: 'Chercher dans la mémoire',
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    write_file: {
      name: 'write_file',
      description: 'Écrire un fichier',
      riskLevel: 'medium',
      enabled: true,
      requiresConfirmation: true,
    },
    write_clipboard: {
      name: 'write_clipboard',
      description: 'Écrire dans le presse-papier',
      riskLevel: 'medium',
      enabled: true,
      requiresConfirmation: true,
    },
    open_app: {
      name: 'open_app',
      description: 'Ouvrir une application',
      riskLevel: 'high',
      enabled: true,
      requiresConfirmation: true,
    },
    store_memory: {
      name: 'store_memory',
      description: 'Enregistrer en mémoire',
      riskLevel: 'medium',
      enabled: true,
      requiresConfirmation: false,
    },
    analyze_stacktrace: {
      name: 'analyze_stacktrace',
      description: "Analyser une trace d'erreur (stacktrace) et en extraire la cause",
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
      description: 'Lire le diff git et rédiger un message de commit',
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    generate_pr_description: {
      name: 'generate_pr_description',
      description: "Lire l'historique et le diff git, rédiger une description de PR",
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    generate_unit_tests: {
      name: 'generate_unit_tests',
      description: 'Détecter le framework de test et générer des tests unitaires pour un fichier',
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    suggest_refactor: {
      name: 'suggest_refactor',
      description:
        'Repérer des refactorisations possibles (fonctions longues, duplication, complexité) dans un fichier',
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    review_diff: {
      name: 'review_diff',
      description:
        'Relire un diff git et signaler les problèmes probables (secrets, code de débogage, motifs risqués)',
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    analyze_dependencies: {
      name: 'analyze_dependencies',
      description:
        'Analyser package.json / Cargo.toml / requirements.txt et signaler les dépendances obsolètes ou risquées',
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    watch_ci: {
      name: 'watch_ci',
      description: 'Surveiller les exécutions GitHub Actions et remonter les erreurs de build',
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    bisect_guided: {
      name: 'bisect_guided',
      description:
        'Piloter un git bisect : compter les commits suspects, choisir le prochain à tester, donner les commandes',
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    detect_spiral: {
      name: 'detect_spiral',
      description:
        "Détecter quand l'utilisateur tourne en rond sur un problème et proposer une pause ou une autre approche",
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    generate_standup: {
      name: 'generate_standup',
      description:
        "Rédiger un standup quotidien (hier, aujourd'hui, blocages) à partir de l'activité git",
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    summarize_git_log: {
      name: 'summarize_git_log',
      description:
        "Résumer l'historique git par type, auteur ou zone, sur une période ou un chemin",
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    resolve_conflicts: {
      name: 'resolve_conflicts',
      description:
        'Découper les fichiers en conflit de fusion (ours/theirs) pour proposer une résolution',
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    load_project_context: {
      name: 'load_project_context',
      description:
        "Profiler un projet à l'ouverture : pile technique, scripts, structure, points d'entrée, résumé du README",
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    analyze_code_style: {
      name: 'analyze_code_style',
      description:
        "Déduire les conventions de style (indentation, guillemets, points-virgules, nommage) d'un échantillon de fichiers",
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    semantic_search: {
      name: 'semantic_search',
      description: 'Chercher dans les fichiers locaux par mots-clés ou par sens',
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    read_webpage: {
      name: 'read_webpage',
      description: 'Lire une page web et en extraire le texte',
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    fetch_tech_news: {
      name: 'fetch_tech_news',
      description: "Rassembler l'actu tech du jour (Hacker News, The Verge, TechCrunch, DEV.to…)",
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    search_dailies: {
      name: 'search_dailies',
      description:
        'Chercher et lire les dailys de la revue de presse (locales et partagées) pour répondre sur les articles',
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    post_tech_news_discord: {
      name: 'post_tech_news_discord',
      description: "Récupérer l'actu tech du jour et la publier sur le webhook Discord configuré",
      riskLevel: 'medium',
      enabled: true,
      requiresConfirmation: false,
    },
    obsidian_notes: {
      name: 'obsidian_notes',
      description: 'Chercher et lire des notes dans un coffre Obsidian local',
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    notion_search: {
      name: 'notion_search',
      description: "Chercher et lire des pages ou bases Notion via l'API Notion",
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    send_webhook_message: {
      name: 'send_webhook_message',
      description: "Publier un message sur un webhook Discord ou Slack (envoi vers l'extérieur)",
      riskLevel: 'high',
      enabled: true,
      requiresConfirmation: true,
    },
    call_api: {
      name: 'call_api',
      description:
        'Appeler une API REST en HTTP/JSON (lecture automatique, écriture sur confirmation)',
      riskLevel: 'high',
      enabled: true,
      requiresConfirmation: true,
    },
    read_email: {
      name: 'read_email',
      description:
        'Lire une boîte mail en IMAP (lecture seule) : messages récents ou un message par UID. Connexion réseau avec identifiants',
      riskLevel: 'high',
      enabled: true,
      requiresConfirmation: true,
    },
    run_subagent: {
      name: 'run_subagent',
      description: 'Lancer un sous-agent indépendant pour mener une tâche en autonomie',
      riskLevel: 'medium',
      enabled: true,
      requiresConfirmation: false,
    },
    run_parallel_agents: {
      name: 'run_parallel_agents',
      description: 'Lancer plusieurs sous-agents en parallèle sur des tâches indépendantes',
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
      description: "Lister ou chercher les issues GitHub d'un dépôt",
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    github_get_pr: {
      name: 'github_get_pr',
      description:
        "Lire le détail d'une pull request, ses fichiers modifiés et, au besoin, le diff",
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    docker_ps: {
      name: 'docker_ps',
      description: "Lister les conteneurs Docker et, au besoin, les derniers logs d'un conteneur",
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    docker_control: {
      name: 'docker_control',
      description: 'Démarrer, arrêter ou relancer un conteneur, ou un projet compose (up/down)',
      riskLevel: 'high',
      enabled: true,
      requiresConfirmation: true,
    },
    run_sqlite: {
      name: 'run_sqlite',
      description: 'Exécuter du SQL sur une base SQLite locale (lecture seule par défaut)',
      riskLevel: 'medium',
      enabled: true,
      requiresConfirmation: false,
    },
    query_database: {
      name: 'query_database',
      description:
        'Exécuter du SQL sur une base Postgres ou MySQL/MariaDB (lecture seule par défaut, transaction READ ONLY)',
      riskLevel: 'medium',
      enabled: true,
      requiresConfirmation: false,
    },
    audit_env: {
      name: 'audit_env',
      description: 'Comparer .env à .env.example : clés manquantes, secrets et valeurs vides',
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    inspect_port: {
      name: 'inspect_port',
      description: 'Lister les ports TCP en écoute et les processus qui les tiennent',
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
    },
    kill_process: {
      name: 'kill_process',
      description: 'Arrêter un processus par son PID',
      riskLevel: 'high',
      enabled: true,
      requiresConfirmation: true,
    },
    run_command: {
      name: 'run_command',
      description: 'Exécuter une commande système',
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
