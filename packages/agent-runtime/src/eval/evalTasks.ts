/**
 * Jeu de tâches du banc de qualité : des demandes en français telles qu'on les
 * formule vraiment, et ce qu'elles doivent produire dans le monde simulé
 * (`simulatedWorld.ts`).
 *
 * DEUX JEUX, et la règle qui leur donne un sens :
 * - `dev` sert à régler (mots-clés de sélection, prompt, descriptions) ;
 * - `holdout` ne sert qu'à mesurer. On ne règle JAMAIS rien en le regardant,
 *   sinon il mesure notre mémoire, plus la généralisation.
 *
 * Une phrase de `holdout` qui échoue ne se corrige donc pas en ajoutant son mot
 * aux mots-clés : on règle à partir de `dev`, ou on y déplace la phrase et on en
 * écrit une nouvelle dans `holdout`.
 */

export type EvalSplit = 'dev' | 'holdout';

export type EvalCategory =
  | 'mails'
  | 'agenda'
  | 'bourse'
  | 'ecran'
  | 'documents'
  | 'fichiers'
  | 'systeme'
  | 'connecteurs'
  | 'navigateur'
  | 'memoire'
  | 'recherche'
  | 'planification'
  | 'presse-papier'
  | 'sans-outil';

export interface EvalTask {
  id: string;
  split: EvalSplit;
  category: EvalCategory;
  input: string;
  /** Outils acceptables : au moins un doit être appelé. Vide : aucun outil attendu. */
  tools: readonly string[];
  /** Motif attendu dans les arguments (JSON) de l'outil appelé. Sans drapeau `g`. */
  args?: RegExp;
  /** Motif attendu dans la réponse finale. Sans drapeau `g`. */
  answer?: RegExp;
  /**
   * Comptée pour la sélection seulement, sans passer par le modèle : demande mal
   * posée pour un run complet (« copie ça », sans contenu, où il a raison de
   * redemander), ou question de la liste `QUIET_QUESTIONS`.
   */
  selectionOnly?: boolean;
  /**
   * Piège : la question évoque un outil sans en demander un (« c'est quoi une
   * action ? »). Le modèle ne doit rien appeler, mais la sélection peut proposer
   * l'outil sans que ce soit une faute.
   */
  trap?: boolean;
}

type TaskOptions = Pick<EvalTask, 'args' | 'answer' | 'selectionOnly' | 'trap'>;

function task(
  split: EvalSplit,
  category: EvalCategory,
  id: string,
  input: string,
  tools: readonly string[],
  options: TaskOptions = {},
): EvalTask {
  return { id, split, category, input, tools, ...options };
}

const dev = (
  category: EvalCategory,
  id: string,
  input: string,
  tools: readonly string[],
  options?: TaskOptions,
): EvalTask => task('dev', category, id, input, tools, options);

const holdout = (
  category: EvalCategory,
  id: string,
  input: string,
  tools: readonly string[],
  options?: TaskOptions,
): EvalTask => task('holdout', category, `h-${id}`, input, tools, options);

const SCREEN_TOOLS = ['describe_screen', 'capture_screen', 'ocr_region'];

/**
 * Questions de tous les jours, auxquelles on répond de tête. Elles ne servent qu'à
 * vérifier que la sélection n'ajoute aucun outil : chaque outil en trop coûte ~2 s
 * hors cache. Six questions ne suffisaient pas : elles passaient toutes, alors que
 * plus des trois quarts des questions écrites par le modèle tiraient un outil.
 * Beaucoup emploient exprès un mot des descriptions (« nom », « résultat »,
 * « tache », « liste », « fer »), sans rien demander à l'outil.
 */
const QUIET_QUESTIONS: readonly (readonly [id: string, input: string])[] = [
  ['fleuve', 'quel est le plus long fleuve de France ?'],
  ['planetes', 'combien de planètes tournent autour du Soleil ?'],
  ['saisons', 'qui a composé les Quatre Saisons ?'],
  ['marignan', 'en quelle année a eu lieu la bataille de Marignan ?'],
  ['conjugaison', 'comment on conjugue le verbe résoudre au présent ?'],
  ['accord', 'on écrit ils se sont parlé ou parlés ?'],
  ['definition', 'que veut dire le mot éphémère ?'],
  ['crepes', 'comment réussir une pâte à crêpes sans grumeaux ?'],
  ['oeuf', 'combien de temps faire cuire un œuf mollet ?'],
  ['pourcent', 'combien font 15 % de 240 ?'],
  ['mile', 'combien de mètres dans un mile ?'],
  ['cadeau', 'une idée de cadeau pour les 60 ans de ma mère ?'],
  ['sommeil', 'comment mieux dormir quand on est stressé ?'],
  ['basilic', 'pourquoi les feuilles de mon basilic jaunissent ?'],
  ['tache-vin', 'comment enlever une tache de vin sur une nappe ?'],
  ['courses', 'fais-moi une liste de courses pour une raclette'],
  ['nom-chat', 'quel nom donner à un chat roux ?'],
  ['puissance', "c'est quoi le résultat de 2 puissance 10 ?"],
  ['rouille', "pourquoi le fer rouille à l'air libre ?"],
  ['film', 'un bon film à regarder ce soir en famille ?'],
  ['japon', 'quelle est la meilleure période pour visiter le Japon ?'],
  ['peuple', 'quel est le pays le plus peuplé du monde ?'],
  ['espace', "qui a été le premier homme dans l'espace ?"],
  ['desert', 'quel est le plus grand désert du monde ?'],
  ['virus', 'explique-moi la différence entre un virus et une bactérie'],
  ['salutations', "reformule : je vous prie d'agréer mes salutations"],
  ['poeme', "écris un petit poème sur l'automne"],
  ['blague', 'raconte-moi une blague'],
  ['merci', "merci beaucoup, c'est parfait"],
  ['velo', 'comment régler les freins de mon vélo ?'],
  // « master » et « devoir » seuls ne désignent pas Nexus (voir toolKeywords)
  ['etudes', "c'est quoi la différence entre une licence et un master ?"],
  ['devoir-verbe', 'je vais devoir cuisiner pour huit, une idée de plat ?'],
];

export const EVAL_TASKS: readonly EvalTask[] = [
  // ─── dev ──────────────────────────────────────────────────────────────────
  dev('mails', 'mail-derniers', 'lis mes derniers mails', ['read_email'], {
    answer: /edf|claire|cr[ée]dit agricole/i,
  }),
  dev('mails', 'mail-banque', "est-ce que j'ai reçu un message de ma banque ?", ['read_email'], {
    answer: /cr[ée]dit agricole|relev[ée]/i,
  }),
  dev('agenda', 'agenda-demain', "qu'est-ce que j'ai à l'agenda demain ?", ['read_calendar'], {
    answer: /dentiste/i,
  }),
  dev(
    'agenda',
    'agenda-semaine',
    "j'ai quoi comme rendez-vous cette semaine ?",
    ['read_calendar'],
    {
      answer: /dentiste|budget/i,
    },
  ),
  dev('bourse', 'bourse-apple', "combien vaut l'action Apple ?", ['get_market'], {
    answer: /231[.,]4/,
  }),
  dev('bourse', 'bourse-cac', "le CAC 40 a fait quoi aujourd'hui ?", ['get_market'], {
    answer: /8[\s\u00a0\u202f]?124|0[.,]6/,
  }),
  dev('bourse', 'watch-ajout', 'ajoute Nvidia à ma watchlist', ['add_to_watchlist'], {
    args: /nvda|nvidia/i,
  }),
  dev('bourse', 'watch-retrait', 'retire Tesla de ma liste', ['remove_from_watchlist'], {
    args: /tsla|tesla/i,
  }),
  dev('bourse', 'formule-per', 'crée une formule PER pour Apple', ['set_formula']),
  dev('ecran', 'ecran-quoi', "qu'est-ce qu'il y a sur mon écran ?", SCREEN_TOOLS),
  dev('ecran', 'ecran-texte', "lis le texte affiché à l'écran", ['ocr_region'], {
    answer: /1[\s\u00a0\u202f]?284/,
  }),
  dev('documents', 'doc-pdf', 'résume ce PDF C:/docs/rapport.pdf', ['parse_document'], {
    args: /rapport\.pdf/,
    answer: /12\s?%/,
  }),
  dev('documents', 'data-excel', 'analyse le fichier excel ventes.xlsx', ['analyze_data'], {
    args: /ventes\.xlsx/,
  }),
  dev('documents', 'export-pdf', 'exporte cette note en PDF', ['export_document'], {
    selectionOnly: true,
  }),
  dev('documents', 'audio-fichier', 'transcris ce fichier audio', ['transcribe_audio'], {
    selectionOnly: true,
  }),
  dev('systeme', 'app-spotify', 'ouvre Spotify', ['open_app'], { args: /spotify/i }),
  dev('systeme', 'app-calc', 'lance la calculatrice', ['open_app'], { args: /calc/i }),
  dev('connecteurs', 'obs-projet', 'cherche dans mes notes Obsidian le projet Atlas', [
    'obsidian_notes',
  ]),
  dev('connecteurs', 'notion-budget', 'retrouve ma page Notion sur le budget', ['notion_search']),
  dev(
    'connecteurs',
    'nexus-devoirs',
    "quels devoirs j'ai à rendre cette semaine ?",
    ['nexus_courses'],
    { selectionOnly: true },
  ),
  dev(
    'connecteurs',
    'nexus-cours',
    "cherche dans mes cours ce que le prof a dit sur l'attention",
    ['nexus_courses'],
    { selectionOnly: true },
  ),
  dev('connecteurs', 'nexus-note', 'prends note de relire le TD 3', ['nexus_inbox'], {
    selectionOnly: true,
  }),
  dev('connecteurs', 'webhook-slack', 'envoie ce résumé sur Slack', ['send_webhook_message'], {
    selectionOnly: true,
  }),
  dev(
    'navigateur',
    'nav-lemonde',
    'va sur lemonde.fr et clique sur le premier article',
    ['browser_navigate'],
    { args: /lemonde/i },
  ),
  dev('presse-papier', 'clip-ecrit', 'copie ça dans le presse-papier', ['write_clipboard'], {
    selectionOnly: true,
  }),
  dev('fichiers', 'fic-ecrire', 'enregistre ce texte dans notes.txt', ['write_file'], {
    selectionOnly: true,
  }),
  dev('fichiers', 'fic-telechargements', 'quels fichiers y a-t-il dans mes téléchargements ?', [
    'list_directory',
  ]),
  dev('fichiers', 'fic-lire', "ouvre config.json et dis-moi ce qu'il contient", ['read_file'], {
    args: /config\.json/,
  }),
  dev('memoire', 'mem-note', 'souviens-toi que je préfère les réponses courtes', ['store_memory']),
  dev('systeme', 'sys-ipconfig', 'exécute la commande ipconfig', ['run_command'], {
    args: /ipconfig/i,
  }),
  dev('systeme', 'sys-ip', 'quelle est mon adresse IP ?', ['run_command'], {
    answer: /192\.168\.1\.42/,
  }),
  dev('connecteurs', 'discord-actus', 'publie les actus tech sur Discord', [
    'post_tech_news_discord',
  ]),
  dev('planification', 'plan-annule', 'annule la tâche planifiée de ce matin', [
    'cancel_scheduled_task',
  ]),
  dev(
    'recherche',
    'agents-parallele',
    'compare ces trois sujets en parallèle',
    ['run_parallel_agents'],
    { selectionOnly: true },
  ),
  dev('recherche', 'docs-locaux', 'cherche dans mes documents locaux le contrat de bail', [
    'semantic_search',
  ]),
  dev(
    'recherche',
    'rech-dailys',
    "qu'est-ce que les dailys disent sur Nvidia ?",
    ['search_dailies'],
    { answer: /blackwell|nvidia/i },
  ),
  dev('recherche', 'rech-tech', 'donne-moi les actus tech du jour', ['fetch_tech_news']),
  dev('recherche', 'rech-page', 'lis https://exemple.fr/article et résume-le', ['read_webpage'], {
    answer: /tramway|lyon/i,
  }),
  dev('planification', 'plan-liste', 'quelles sont mes tâches planifiées ?', [
    'list_scheduled_tasks',
  ]),
  dev('planification', 'plan-creer', "planifie un résumé de l'actu tous les jours", [
    'schedule_task',
  ]),
  dev('memoire', 'mem-rappel', "qu'est-ce que tu sais de mon comptable ?", ['search_memory'], {
    answer: /durand/i,
  }),
  dev('presse-papier', 'clip-lire', 'lis mon presse-papier', ['read_clipboard'], {
    answer: /lyon/i,
  }),
  dev('sans-outil', 'none-capitale', "quelle est la capitale de l'Italie ?", [], {
    answer: /rome/i,
  }),
  dev('sans-outil', 'none-bonjour', 'bonjour, ça va ?', []),
  dev('sans-outil', 'none-heure', 'quelle heure est-il ?', [], { answer: /\d{1,2}\s?(h|:)/i }),
  dev('sans-outil', 'none-joconde', 'qui a peint la Joconde ?', [], { answer: /vinci/i }),
  dev('sans-outil', 'none-racine', 'quelle est la racine carrée de 144 ?', [], { answer: /12/ }),
  dev('sans-outil', 'none-repas', 'donne-moi une idée de repas rapide', []),
  ...QUIET_QUESTIONS.map(([id, input]) =>
    dev('sans-outil', `quiet-${id}`, input, [], { selectionOnly: true }),
  ),

  // ─── holdout : à ne jamais regarder pour régler ───────────────────────────
  holdout('mails', 'mail-qui', "qui m'a écrit ce matin ?", ['read_email'], {
    answer: /edf|claire|cr[ée]dit agricole/i,
  }),
  holdout(
    'mails',
    'mail-edf',
    'retrouve la facture EDF dans ma boîte de réception',
    ['read_email'],
    {
      answer: /82[.,]40/,
    },
  ),
  holdout('mails', 'mail-nonlu', "j'ai du courrier non lu ?", ['read_email']),
  holdout('agenda', 'agenda-rdv', "j'ai un rdv mardi ?", ['read_calendar']),
  holdout('agenda', 'agenda-planning', "qu'est-ce qui est prévu jeudi dans mon planning ?", [
    'read_calendar',
  ]),
  holdout(
    'agenda',
    'agenda-ics',
    'regarde C:/Users/moi/Documents/agenda.ics et dis-moi quand est mon prochain rendez-vous',
    ['read_calendar'],
    { args: /agenda\.ics/, answer: /dentiste/i },
  ),
  holdout('bourse', 'bourse-total', 'ça donne quoi TotalEnergies en bourse ?', ['get_market'], {
    answer: /61[.,]2/,
  }),
  holdout('bourse', 'bourse-btc', 'quel est le cours du bitcoin ?', ['get_market'], {
    answer: /71[\s\u00a0\u202f]?540/,
  }),
  holdout('bourse', 'bourse-marches', 'les marchés sont comment ce matin ?', ['get_market']),
  holdout('bourse', 'watch-suivre', 'suis aussi LVMH dans mes valeurs', ['add_to_watchlist'], {
    args: /mc\.pa|lvmh/i,
  }),
  holdout('bourse', 'watch-stop', 'arrête de suivre Airbus', ['remove_from_watchlist'], {
    args: /air/i,
  }),
  holdout('ecran', 'ecran-affiche', "qu'est-ce qui s'affiche là ?", SCREEN_TOOLS),
  holdout('ecran', 'ecran-fenetre', 'regarde ma fenêtre et dis-moi ce que tu vois', SCREEN_TOOLS),
  holdout('ecran', 'ecran-capture', "fais une capture d'écran", ['capture_screen']),
  holdout('ecran', 'ecran-erreur', "quel message d'erreur est écrit sur mon écran ?", SCREEN_TOOLS),
  holdout(
    'documents',
    'doc-word',
    'que dit le contrat.docx dans mes documents ?',
    ['parse_document'],
    { args: /contrat\.docx/ },
  ),
  holdout(
    'documents',
    'doc-synthese',
    'fais-moi la synthèse de C:/docs/etude.pdf',
    ['parse_document'],
    { args: /etude\.pdf/ },
  ),
  holdout(
    'documents',
    'data-moyenne',
    'calcule la moyenne de la colonne prix dans C:/data/stock.csv',
    ['analyze_data'],
    { args: /stock\.csv/ },
  ),
  holdout(
    'documents',
    'export-word',
    'mets ce compte-rendu en Word : réunion du 4, budget validé',
    ['export_document'],
  ),
  holdout(
    'documents',
    'audio-memo',
    'retranscris le mémo vocal C:/audio/memo.m4a',
    ['transcribe_audio'],
    { args: /memo\.m4a/, answer: /garagiste/i },
  ),
  holdout('fichiers', 'fic-dossier', 'le dossier Images contient quoi ?', ['list_directory']),
  holdout(
    'fichiers',
    'fic-montre',
    "montre-moi ce qu'il y a dans C:/temp/todo.txt",
    ['read_file'],
    {
      args: /todo\.txt/,
    },
  ),
  holdout(
    'fichiers',
    'fic-cree',
    'crée un fichier courses.md avec du pain et du lait',
    ['write_file'],
    { args: /courses\.md/ },
  ),
  holdout('systeme', 'app-vlc', 'démarre VLC', ['open_app'], { args: /vlc/i }),
  holdout('systeme', 'app-blocnotes', 'ouvre le bloc-notes', ['open_app'], {
    args: /note/i,
  }),
  holdout('systeme', 'sys-disque', "combien d'espace reste-t-il sur le disque C ?", [
    'run_command',
  ]),
  holdout('systeme', 'sys-version', "quelle version de Windows j'ai ?", ['run_command']),
  holdout('connecteurs', 'obs-recette', 'dans mon coffre Obsidian, retrouve la recette du pain', [
    'obsidian_notes',
  ]),
  holdout('connecteurs', 'notion-lancement', 'as-tu quelque chose dans Notion sur le lancement ?', [
    'notion_search',
  ]),
  holdout(
    'connecteurs',
    'webhook-equipe',
    "préviens l'équipe sur Discord que la démo est à 15 h",
    ['send_webhook_message'],
    { args: /15/ },
  ),
  holdout('navigateur', 'nav-sncf', 'va sur le site de la SNCF', [
    'browser_navigate',
    'read_webpage',
  ]),
  holdout('navigateur', 'nav-clic', 'clique sur le bouton Connexion de la page', ['browser_click']),
  holdout('navigateur', 'nav-saisie', 'tape Paris dans le champ de recherche du site', [
    'browser_type',
  ]),
  holdout('memoire', 'mem-vol', 'retiens que mon vol part le 12 décembre', ['store_memory'], {
    args: /12/,
  }),
  holdout(
    'memoire',
    'mem-comptable',
    'tu te souviens du nom de mon comptable ?',
    ['search_memory'],
    {
      answer: /durand/i,
    },
  ),
  holdout(
    'recherche',
    'rech-journaux',
    'que disent les journaux de Mistral ?',
    ['search_dailies'],
    {
      answer: /1,2|lev[ée]e/i,
    },
  ),
  holdout(
    'recherche',
    'rech-page',
    'résume cette page : https://exemple.fr/article',
    ['read_webpage'],
    { answer: /tramway|lyon/i },
  ),
  holdout('recherche', 'rech-tech', 'quoi de neuf dans la tech ?', ['fetch_tech_news']),
  holdout('planification', 'plan-tournent', 'quelles tâches tournent en ce moment ?', [
    'list_scheduled_tasks',
  ]),
  holdout('planification', 'plan-matins', "tous les matins, résume-moi l'actu de l'IA", [
    'schedule_task',
  ]),
  holdout('planification', 'plan-supprime', 'supprime ma tâche du matin', [
    'cancel_scheduled_task',
  ]),
  holdout('presse-papier', 'clip-copie', "qu'est-ce que j'ai copié ?", ['read_clipboard'], {
    answer: /lyon/i,
  }),
  holdout(
    'presse-papier',
    'clip-mets',
    'mets « à bientôt » dans le presse-papier',
    ['write_clipboard'],
    { args: /bient/i },
  ),
  holdout('sans-outil', 'none-germinal', 'qui a écrit Germinal ?', [], { answer: /zola/i }),
  holdout('sans-outil', 'none-calcul', 'combien font 17 fois 6 ?', [], { answer: /102/ }),
  holdout('sans-outil', 'none-trad', 'traduis « bonne année » en espagnol', [], {
    answer: /feliz/i,
  }),
  holdout('sans-outil', 'none-photo', 'explique la photosynthèse en deux phrases', []),
  holdout('sans-outil', 'none-canada', 'quelle est la capitale du Canada ?', [], {
    answer: /ottawa/i,
  }),
  holdout('sans-outil', 'none-synonyme', 'donne-moi un synonyme de rapide', []),
  holdout('sans-outil', 'trap-action', "c'est quoi une action en bourse ?", [], { trap: true }),
  holdout('sans-outil', 'trap-pdf', 'comment on ouvre un fichier PDF sous Windows ?', [], {
    trap: true,
  }),
];
