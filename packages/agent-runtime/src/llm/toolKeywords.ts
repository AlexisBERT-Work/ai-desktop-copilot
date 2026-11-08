/**
 * Vocabulaire d'intention des outils : les mots que les gens emploient, et que
 * la description, écrite pour le modèle, n'emploie pas. « agenda » n'apparaît
 * pas dans « fichier calendrier .ics » : sans cette table, read_calendar n'était
 * jamais proposé, et le modèle répondait à côté plutôt que d'avouer ne pas savoir.
 *
 * LU PAR `selectTools` SEULEMENT, JAMAIS ENVOYÉ AU MODÈLE : ces mots n'ajoutent
 * aucun token au prompt, donc aucune latence. Ne pas les recopier dans les
 * descriptions : chaque outil proposé coûte déjà ~2 s de lecture hors cache.
 *
 * Une expression désigne un début de mot, sans souci des accents ni de la casse :
 * « rendez-vous » trouve « rendez vous », « action » trouve « actions » mais pas
 * « transaction ». Éviter les mots courants, même s'ils sont justes : « suis »
 * (« je suis ») ou « marche » (« ça marche ») tireraient un outil à chaque
 * phrase. Un mot-clé suffit à lui seul à faire proposer l'outil, alors qu'il faut
 * deux mots communs avec la description : chaque entrée doit donc désigner l'outil
 * sans ambiguïté (« enlève » tirait la watchlist sur « enlever une tache »). Tout
 * outil hors noyau a besoin d'une entrée, y compris ceux du profil `full`, sans quoi
 * un mot seul (« docker ») ne le trouve plus. Le noyau de `selectTools` n'en a pas
 * besoin : il est toujours là.
 *
 * Pour régler cette table : `pnpm --filter @catdesk/agent-runtime eval --selection`,
 * à partir des ratés du jeu `dev` ou de phrases écrites pour l'occasion, jamais de
 * celles qui servent à mesurer (voir `eval/evalTasks.ts`).
 */
export const TOOL_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  // Fichiers
  read_file: ['fichier', 'json', 'txt', 'yaml', 'xml', 'contient', 'contenu de'],
  list_directory: [
    'dossier',
    'répertoire',
    'téléchargement',
    'quels fichiers',
    'les fichiers',
    'liste des fichiers',
    'arborescence',
  ],
  write_file: [
    'enregistre',
    'sauvegarde',
    'écris dans',
    'crée un fichier',
    'nouveau fichier',
    'dans un fichier',
    'txt',
  ],

  // Système
  run_command: [
    'commande',
    'powershell',
    'terminal',
    'ipconfig',
    'ping',
    'adresse ip',
    'mon ip',
    'espace disque',
    'mémoire vive',
    'processeur',
  ],
  open_app: ['ouvre', 'lance', 'démarre', 'application', 'logiciel', 'calculatrice', 'bloc-notes'],

  // Presse-papiers, mémoire
  write_clipboard: ['presse-papier', 'copie', 'colle'],
  store_memory: [
    'souviens-toi',
    'retiens',
    'rappelle-toi',
    'mémorise',
    'garde en tête',
    "à l'esprit",
    'pour plus tard',
    'stocke',
    "n'oublie pas",
  ],
  semantic_search: [
    'documents locaux',
    'mes documents',
    'dans mes fichiers',
    'recherche locale',
    'qui parle de',
    'qui parlent de',
    'qui abordent',
    'fichiers qui',
    'documents qui',
  ],

  // Connecteurs
  read_email: [
    'mail',
    'email',
    'e-mail',
    'courriel',
    'boîte de réception',
    'messagerie',
    'gmail',
    'outlook',
    'reçu un message',
    'nouveau message',
    'nouveaux messages',
    "m'a écrit",
  ],
  obsidian_notes: [
    'obsidian',
    'vault',
    'mes notes',
    'les notes',
    'quelles notes',
    'note intitulée',
    'note nommée',
  ],
  // Nexus, l'application du Master. Jamais « cours » seul (cours de Bourse : « cours de »,
  // « cours du » sont à get_market), ni « devoir » (« je vais devoir »), ni « master »
  // seul (la branche git).
  nexus_courses: [
    'nexus',
    'mon master',
    'du master',
    'au master',
    'sup de vinci',
    'mes cours',
    'mon cours',
    'ce cours',
    'devoirs',
    'à rendre',
    'mon partiel',
    'mes partiels',
    'le partiel',
    'examen',
    'mes évaluations',
    'ma moyenne',
    'mes moyennes',
    'réviser',
    'révisions',
    'notebook',
    'chapitre du cours',
    'le prof',
    'la prof',
  ],
  nexus_inbox: ['note rapide', 'notes rapides', 'inbox', 'prends note', 'note dans nexus'],
  notion_search: ['notion'],
  send_webhook_message: ['slack', 'discord', 'webhook', 'envoie sur', 'poste sur'],
  post_tech_news_discord: ['discord', 'publie', 'revue de presse'],
  call_api: ['api', 'endpoint', 'requête http', 'serveur', 'service en ligne'],

  // Écran
  capture_screen: ['capture', 'screenshot', 'écran'],
  ocr_region: ['ocr', 'écran', 'texte affiché', 'ce qui est affiché'],
  describe_screen: ['écran', 'fenêtre', 'que vois', 'tu vois', 'interface', 'est affiché'],

  // Documents
  parse_document: ['pdf', 'docx', 'word', 'document', 'rapport', 'contrat'],
  analyze_data: [
    'excel',
    'xlsx',
    'csv',
    'tableur',
    'feuille de calcul',
    'colonne',
    'statistique',
    'ce tableau',
    'mon tableau',
    'les totaux',
  ],
  export_document: ['exporte', 'convertis', 'en pdf', 'en word', 'en docx', 'en html', 'markdown'],
  transcribe_audio: [
    'transcri',
    'retranscri',
    'audio',
    'mémo vocal',
    'enregistrement',
    'mp3',
    'wav',
  ],
  read_calendar: [
    'agenda',
    'calendrier',
    'rendez-vous',
    'rdv',
    'réunion',
    'emploi du temps',
    'événement',
    'planning',
    'ics',
  ],

  // Bourse
  get_market: [
    'bourse',
    'boursi',
    'action',
    'cours de',
    'cours du',
    'combien vaut',
    'cotation',
    'cac',
    'nasdaq',
    'dow jones',
    'bitcoin',
    'crypto',
    'portefeuille',
    'marchés financiers',
    'les marchés',
    'des marchés',
    'mes placements',
    'mes titres',
    'liste de suivi',
  ],
  add_to_watchlist: [
    'watchlist',
    'surveille',
    'ma liste',
    'mes valeurs',
    'mes favoris',
    'liste de suivi',
    "liste d'observation",
  ],
  remove_from_watchlist: [
    'watchlist',
    'je surveille',
    'ma liste',
    'mes valeurs',
    'liste de suivi',
    "liste d'observation",
  ],
  set_formula: ['formule', 'ratio'],
  remove_formula: ['formule'],

  // Navigateur : un run ne change pas d'outils en route, et naviguer sans pouvoir
  // lire la page ni cliquer ne mène à rien. D'où les mots partagés.
  browser_navigate: [
    'site',
    'va sur',
    'navigue',
    'navigateur',
    'clique',
    'www',
    'connecte-toi',
    'ce lien',
  ],
  browser_get_text: [
    'site',
    'va sur',
    'navigateur',
    'clique',
    'texte de la page',
    'sur la page',
    'cette page',
    'la page actuelle',
  ],
  browser_screenshot: ['capture du site', 'capture de la page', "capture d'écran de la page"],
  browser_click: ['clique', 'bouton', 'coche'],
  browser_type: ['saisis', 'tape', 'remplis', 'champ', 'formulaire'],
  browser_close: ['ferme le navigateur'],

  // Automatisation
  run_subagent: [
    'délègue',
    'sous-agent',
    'agent dédié',
    'agent autonome',
    'agent séparé',
    'agent secondaire',
  ],
  run_parallel_agents: ['parallèle', 'en même temps', 'simultanément'],
  cancel_scheduled_task: [
    'annule',
    'supprime',
    'tâche planifiée',
    'arrête la tâche',
    'arrêter une tâche',
  ],

  // Profil `full` seulement (développement, infra) : hors du banc de qualité.
  analyze_stacktrace: ['stacktrace', 'stack trace', 'pile d’appels'],
  analyze_logs: ['logs', 'fichier de log'],
  generate_unit_tests: ['tests unitaires', 'test unitaire'],
  suggest_refactor: ['refactor', 'refacto'],
  analyze_dependencies: ['dépendances', 'package.json'],
  generate_commit_message: ['commit'],
  generate_pr_description: ['pull request', 'description de pr'],
  review_diff: ['diff', 'revue de code', 'relis mon code'],
  summarize_git_log: ['git log', 'historique git'],
  resolve_conflicts: ['conflit de merge', 'conflits de merge', 'conflit git'],
  bisect_guided: ['bisect'],
  watch_ci: ['intégration continue', 'pipeline', 'github actions'],
  detect_spiral: ['spirale', 'tourne en rond'],
  generate_standup: ['standup', 'stand-up'],
  analyze_code_style: ['style de code', 'conventions de code'],
  load_project_context: ['contexte du projet', 'contexte projet'],
  docker_ps: ['docker', 'conteneur'],
  docker_control: ['docker', 'conteneur'],
  run_sqlite: ['sqlite'],
  query_database: ['base de données', 'requête sql'],
  audit_env: ['variables d’environnement', 'fichier .env'],
  inspect_port: ['ports', 'port ouvert', 'sur le port'],
  kill_process: ['processus'],
  github_list_issues: ['github', 'issues'],
  github_get_pr: ['github', 'pull request'],
};
