# SUIVI — Évolution de CatDesk

> Journal de travail. Voir aussi [CAPACITES.md](CAPACITES.md).
> Dernière mise à jour : 2026-08-05.

## État actuel

**Modèle unique et release 0.1.3 (2026-08-05)** — passage à UN seul modèle de
chat, le plus fort tenant sur 10 Go de VRAM : **`qwen3:14b`** (le palier
`qwen2.5:7b` est retiré du bundle). `recommend_default_model` renvoie toujours le
14b ; frontend (`chatStore`) et `stage-curated-models.ps1` alignés (bundle réduit
à 14b, `minicpm-v` et `nomic-embed-text`). Chat interactif passé en `think:false`
(fin du raisonnement caché de qwen3, latence au premier token nettement réduite)
et texte des modals rendu sélectionnable/copiable. Distribution : installeur
hors-ligne **~18 Go** (contre 22), bootstrap auto-téléchargeur réécrit en
**`curl.exe`** (bien plus rapide, avec reprise `-C -`). Endpoint auto-update
repointé sur le repo **public** `catdesk-releases` (l'ancien pointait sur un repo
privé, 404 anonyme). Publié : `catdesk-releases` **v0.1.3**. Type-check et tests
verts. Commits : `53af71e`, `13f2802`, `b2d11ee`.

**News : console admin dans l'app, plus Supabase Studio (2026-07-20)** —
type-check/lint/tests (37 desktop) verts sur tout le monorepo. Suite au constat
que `news` (Pilier B, annonces admin) n'avait jamais servi — table vide,
rédaction possible SEULEMENT à la main dans Supabase Studio — plutôt que
retirer la fonctionnalité, elle est désormais utilisable depuis l'app :

- **Onglet « Annonces »** dans la Console admin (déjà utilisée pour les dailys
  manuelles), à côté de l'onglet « Dailys manuelles » — même connexion admin,
  un seul point d'entrée. CRUD complet : titre, gravité (info/succès/
  avertissement/critique), corps Markdown, portée (tous les postes ou un uid
  précis), expiration optionnelle.
- **Nouveau module** [`newsAdmin.ts`](../apps/desktop/src/features/news/newsAdmin.ts)
  (`listAllNews`/`createNews`/`updateNews`/`deleteNews`), mirroring
  `dailiesAdmin.ts`. `model.ts` extrait de `useNews.ts` (mapping de ligne
  partagé entre lecture client et écriture admin).
- **Le piège vécu en testant l'API à la main est corrigé dans le code** : un
  test concret plus tôt dans la session a montré qu'omettre
  `audience_client_id` dans un insert le fait basculer **global** par défaut,
  silencieusement. `newsAdmin.ts` l'envoie **toujours** explicitement (`null`
  pour global) ; côté UI, la portée est une case à cocher **visible**, cochée
  par défaut sur « tous les postes » — jamais un champ vide qui déciderait à
  la place de l'admin.
- Pas de sélecteur/annuaire d'uid : cibler un poste précis reste manuel
  (Supabase Studio → Authentication → Users) — construire un annuaire dans
  l'app est un chantier à part, plus gros que ce qui était demandé.
- Reste : vérifier visuellement dans `pnpm dev` (onglet Annonces, publier puis
  supprimer un test) — non fait depuis cette session, seule la vérification
  statique (types/lint/tests existants) a été faite.

**Dailys : publication ouverte à tout poste (2026-07-20)** —
**630 tests agent-runtime (+ 76 fichiers), type-check/lint OK** (demande
utilisateur : « les dailys doivent se lancer à partir du moment où n'importe
quel PC sur terre a lancé le programme CatDesk » — suite à un diagnostic ayant
montré, lecture directe de Supabase à l'appui, que le lot standard n'avait été
publié qu'une seule fois, le 19 juillet, faute d'un poste admin en continu) :

- **Le lot standard (7 journaux + 6 sujets + synthèse) se publie désormais
  depuis n'importe quel poste**, sans identifiants admin — session anonyme +
  nouvelle fonction Postgres `publish_daily_if_missing` (`SECURITY DEFINER`,
  migration
  [`20260720000000_press_digest_open_publish.sql`](../supabase/migrations/20260720000000_press_digest_open_publish.sql)).
  Cette fonction, pas la policy RLS, autorise l'écriture — et **valide
  elle-même** ce qu'elle accepte : titre restreint aux 3 gabarits attendus
  (journal fixe, sujet fixe, synthèse), catégorie parmi les 6 valeurs
  autorisées, corps plafonné à 20 000 caractères, **max 60 lignes/jour**.
  Idempotente au niveau base (contrainte unique sur `title`, `on conflict do
nothing`) : deux postes publiant la même daily en même temps → un seul
  insert passe, l'autre no-op proprement (`SupabasePublisher.publishDailiesOpen`).
- **Pré-check anti-gaspillage** : avant de lancer la génération LLM (coûteuse),
  chaque poste vérifie en lecture anonyme si un autre poste a déjà publié le
  lot du jour (`hasTodaysSharedDigest`) — s'abstient si oui. Reste une petite
  fenêtre de course si plusieurs postes checkent simultanément (génération
  redondante occasionnelle, sans doublon en base grâce à la contrainte
  unique) : compromis accepté, pas over-engineeré avec un vrai verrou distribué.
  Choix validé par l'utilisateur : anti-abus « léger » (gabarits + plafond)
  plutôt qu'un jeton partagé ou l'absence totale de garde-fou.
- **Identifiants admin devenus optionnels** : ils n'activent plus que les
  extras déjà réservés à l'admin (journaux personnalisés `press_feeds`, miroir
  Discord) — `PressDigestScheduler.runOnce()` restructuré en « lot standard
  toujours, extras admin en plus si configurés ». `CATDESK_PRESS_DIGEST`
  change de polarité : avant opt-in (`=1` requis + 4 identifiants), maintenant
  opt-out (`=0` pour désactiver sur un poste donné) — `.env`/`.env.example`
  mis à jour en conséquence.
- **URL + clé anon Supabase en défaut dans le code** (`index.ts`) : mêmes
  valeurs déjà embarquées dans le build desktop (`VITE_SUPABASE_ANON_KEY`,
  publique par design — RLS est la vraie barrière, pas le secret de la clé).
  Overridable via `SUPABASE_URL`/`SUPABASE_ANON_KEY` pour pointer sur un autre
  projet (dev/test).
- Diagnostic ayant motivé ce chantier : lecture directe de la table Supabase
  (session anonyme, comme le fait le widget) a montré exactement 15 lignes,
  toutes datées du 19 juillet — le planificateur admin-only nécessitait que le
  poste avec les identifiants admin tourne activement au bon moment, ce qui
  n'arrive pas si l'usage réel passe par l'app installée (qui n'a jamais eu ces
  identifiants, par sécurité) ou par un `pnpm dev` lancé par intermittence.
- Nouveaux tests : `SupabasePublisher.test.ts` (9 tests — anon sign-in, appel
  RPC, published/skipped/erreurs, liste vide) et
  `PressDigestScheduler.test.ts` (11 tests — pré-check, fusion journal+sujet,
  extras admin conditionnels, miroir Discord, verrou `running`, reprise après
  erreur).
- Reste : appliquer la migration sur le projet Supabase réel
  (`pnpm exec supabase db push`, voir `supabase/DEPLOY.md`) — pas encore fait,
  c'est un `db push` à lancer par l'utilisateur, pas quelque chose d'exécuté
  depuis cette session. Puis valider en conditions réelles (lancer l'app sur
  un second poste sans identifiants admin, vérifier qu'une daily du jour
  apparaît).

**Bot recentré : questions sur les articles + recherche générale (2026-07-20)** —
**607 tests agent-runtime + 31 desktop, type-check OK** (demande utilisateur :
« principalement répondre aux questions sur les articles, thème recherche,
pas de codage, pas de trucs inutiles ») :

- **Nouvel outil `search_dailies`** (68ᵉ du catalogue) : l'agent peut enfin lire
  les dailys pour répondre aux questions sur les articles — fusion locales
  (« Mes journaux », `LocalDailyStore`) + partagées (nouveau
  `SharedDailyReader` : session Supabase anonyme comme l'UI, cache 60 s,
  dégradation propre en local-seul si non configuré/inaccessible). Filtres
  mots-clés (accents/pluriel tolérés, titre pondéré ×3), catégorie, fenêtre en
  jours ; dédoublonnage par titre (garde la plus récente), expirées exclues,
  corps tronqués à 4 000 car. ; zéro correspondance → liste des titres
  disponibles pour que le LLM reformule au lieu d'halluciner.
- **Profil d'outils `research` par défaut** (`CATDESK_TOOL_PROFILE`, repli
  `full`) : 25 outils dev/infra (analyse de code, git/CI, docker/SQL, GitHub,
  debug système — liste `RESEARCH_EXCLUDED` dans registerTools.ts) ne sont plus
  enregistrés pour le chat → 43 outils exposés, prompt plus court, meilleure
  précision de choix d'outil sur qwen3:14b. Le test de cohérence
  outils ↔ permissions tourne toujours en profil `full`.
- **Prompt système recentré** : mission = articles des dailys + recherche
  d'information ; « PAS un assistant de programmation » sauf demande explicite ;
  guidage `search_dailies` EN PREMIER pour toute question article/actualité,
  citation journal + date, aveu « rien trouvé » + proposition de recherche web.
- **`ESSENTIAL_CORE` de selectTools réorienté** : `search_dailies`,
  `read_webpage`, `fetch_tech_news` toujours exposés ; `read_file`/
  `list_directory`/`run_command` ne remontent plus que si la requête les évoque.
- **Correctif latence après test réel** (réponse ~2 min sur « quelles sont les
  news qui concernent claude ? », routée sur qwen2.5:7b qui annonçait l'outil en
  texte puis déballait 3 dailys entières) : (1) `RESEARCH_HINTS` dans le
  ModelRouter — les questions actu/articles/dailys ne sont plus rétrogradées
  vers le petit modèle ; (2) `search_dailies` passe en **mode extraits** avec
  une query (seuls les blocs Markdown qui matchent, cap 1 500 car./daily,
  ~10× moins de tokens ; `full_text:true` pour le corps complet, repli titres
  seuls conservé) ; (3) note « source partagée indisponible » reformulée pour ne
  plus déclencher une relance ; (4) `CATDESK_TOOL_LIMIT` 14 → 10 schémas par
  appel.
- **Tri des modèles — UN seul modèle de chat par machine** : le palier léger
  auto (`CATDESK_MODEL_SMALL=qwen2.5:7b`, injecté par le launcher Rust) est
  supprimé — sur 10 Go de VRAM le 14b et le 7b ne cohabitent pas, chaque
  rétrogradation forçait un swap de modèle de 10-20 s, plus lent que de répondre
  avec le 14b déjà chaud (reste opt-in via l'env). Le sélecteur Auto/Léger/Code
  du chat est retiré (ModeSelector supprimé, le store n'envoie plus
  lightModel/codeModel — champs du protocole conservés). `qwen2.5-coder:14b`
  sort du bundle installeur (−9 Go, bot sans codage). Lineup final :
  `qwen3:14b` (≥ 9 GiB) ou `qwen2.5:7b` (< 9 GiB) + `nomic-embed-text` +
  `minicpm-v` optionnel hors bundle.
- Reste : valider en réel dans `pnpm dev` (reposer la question Claude et
  chronométrer) ; si la lecture anonyme Supabase est refusée par la RLS, vérifier
  que les sign-ins anonymes sont activés côté projet Supabase.

**Dashboard en canvas libre + extraits d'articles lisibles (2026-07-18/19)** —
**593 tests agent-runtime + 31 desktop, lint 0 warning** :

- **Placement libre façon PowerPoint** (retour utilisateur : « les placer
  littéralement où je veux, de la taille exacte que je veux ») : la grille
  4 colonnes à réordonnancement est remplacée par un canvas en px —
  `layout {x,y,w,h}` en pixels (v2), drag aux pointer events qui pose la carte
  exactement où on la lâche (snap 8 px, zoom UI corrigé, auto-scroll 2 axes,
  Échap = repose à l'origine, widget saisi passé au premier plan), poignées de
  resize en px exacts (badge « 480 × 240 px »), contenu qui défile À L'INTÉRIEUR
  de la carte trop petite. Migration douce des dispositions v1 (unités ≤ 8 →
  gabarit 288×120 px) dans `sanitizeConfig` ; boutons cycle largeur/hauteur
  retirés. Reste : test manuel du ressenti dans `pnpm dev`.
- **Guide mis à jour** (WidgetGuide, exportable PDF) : canvas libre + Style +
  Affichages + zoom dans « Principe général », nouvelle section « Journaux &
  annonces » (portées, génération, admin = dailys manuelles), fiche Dailys
  réécrite (origines Perso/Partagée, filtres, En savoir plus vérifié) ; un
  échantillon du guide illustre le badge « Perso ».
- **Une seule interface de gestion des journaux** : l'écran « Journaux »
  (ex-« Mes journaux ») porte les deux portées — « Ce poste » (backend local)
  et « Partagés (tous) » (backend Supabase, onglet visible si configuré,
  verrouillé par la connexion admin + RLS). L'onglet « Journaux personnalisés »
  de la console admin est supprimé ; la console est recentrée sur les dailys
  manuelles (AdminLogin exporté et réutilisé).
- **Origine des dailys visible** : `Daily.origin` ('shared' | 'local', tagué à
  la fusion dans DailiesWidget) — badge « Perso » (vert, Laptop) vs
  « Partagée » (bleu, Users) + liseré gauche de la même couleur sur chaque
  daily, et sélecteur « Toutes · Partagées · Persos » (persisté par widget,
  affiché seulement quand les deux origines cohabitent).
- **Personnalisation des widgets** : `Widget.style` (accent parmi 6 couleurs +
  taille du texte via zoom local 0.85–1.3, bornes 0.7–1.6) — section « Style »
  commune en tête de l'éditeur de config, application immédiate
  (`setWidgetStyle`). Mode édition rendu évident : header teinté brand + badge
  « Mode édition » + cartes en pointillés. Dailys : chaque article devient un
  bloc bordé distinct (overrides ul/li de NewsMarkdown — vaut aussi pour les
  dailys déjà stockées).
- **Statut de génération visible** : bandeau `PressRunStatusBanner` sur
  l'ACCUEIL du dashboard (états en cours/échec) et dans « Mes journaux »
  (+ état terminé : n dailys à HH:MM) — en cours = journal 2/3, phase
  collecte/rédaction ; échec = message + retentative. Chaîne : `onPhase` (customJournalDigest) →
  `PressRunStatus` (scheduler, notification `press.local.progress`) → event
  Tauri `press:progress` (protocol.rs/bridge.rs, miroir vérifié par cargo test)
  → store localPress. Le statut courant est repoussé au `press.local.sync`
  (panneau ouvert en plein run).
- **« Générer maintenant » régénère vraiment** : les titres de dailys étant
  datés et le store idempotent par titre, re-cliquer le bouton un jour déjà
  publié refaisait tout le travail puis jetait le résultat (aucun titre neuf).
  Le run manuel passe en `force` → `LocalDailyStore.upsert` remplace les dailys
  du jour (id stable, corps et date rafraîchis) ; le run planifié de 7 h garde
  l'idempotence (pas de doublon au redémarrage).
- **Affichages enregistrés (presets de disposition)** : « Réinitialiser »
  devient le panneau « Affichages » — enregistrer la disposition actuelle sous
  un nom (instantané `structuredClone`, indépendant des éditions suivantes),
  restaurer/supprimer d'un clic, disposition par défaut en confirmation 2 clics.
  Persistés (`presets` dans catdesk-dashboard), validés/migrés au rechargement
  (`sanitizePresets`).
- **Fenêtre Marchés & News irrécupérable après fermeture — corrigé** : la garde
  « fermer = masquer » vivait dans un useEffect de DashboardRoot ; son cleanup
  (crash du rendu, HMR) la débranchait, la croix native détruisait alors la
  fenêtre et `getByLabel` renvoyait null → bouton mort jusqu'au redémarrage.
  La garde est posée au chargement du module (main.tsx, hors React) et le
  bouton RECRÉE la fenêtre si elle a malgré tout disparu (openDashboardWindow ;
  permission `core:webview:allow-create-webview-window` ajoutée).
- **Extraits d'articles : fin des phrases hachées** (retour utilisateur : dailys
  citant « ago writing C++ to solve it », coupes « on this benc »). Cause :
  `htmlToText` traitait les retours à la ligne du FICHIER HTML comme des fins de
  ligne → le filtre de prose jetait les débuts de phrase et recollait le reste.
  Corrigé : les retours source deviennent des espaces, seules les balises de
  bloc (ouvrantes ET fermantes) structurent ; `<pre>` sanctuarisés. En aval :
  `cutAtSentence` (coupe à la fin de phrase, pas au mot) sur excerpt/fullText/
  invites LLM/verbatim, `startsMidSentence` écarte les extraits RSS tronqués qui
  démarrent en cours de phrase (repli fullText, ou pas de résumé du tout).

**Suite du refactoring (2026-07-17)** — les quatre chantiers restants du plan
sont terminés. État final : **575 tests agent-runtime + 8 desktop + 5 Python +
22 Rust, lint 0 warning** :

- **AgentOrchestrator** : `process()` décomposé en phases privées à
  comportement identique (`tryServeFromCache`, `streamAssistantTurn` avec la
  rétention de tokens, `runToolCall` porte de permission + scan sécurité,
  `finalizeAnswer` effets de bord) — et **premiers tests de l'orchestrateur**
  (14, faux OllamaClient scripté) : streaming, cache sémantique, boucle
  d'outils (rejeu/refus/exception/récupération `<tool_call>`), interruption,
  MAX_ITERATIONS.
- **Validation zod 67/67 outils** : lots 2-4 migrés — plus AUCUN
  `rawArgs as Args` ; `shared-types/tools.ts` (709 lignes de schémas runtime)
  **supprimé**, le schéma zod de chaque outil est la source unique. Script de
  migration réutilisable : scratchpad `migrate_lot4.py` (génération zod depuis
  les schémas JSON, descriptions/défauts/enums conservés).
- **God components découpés** : SettingsWindow 570→75 l. (onglets ModelTab/
  SecurityTab/HotkeysTab/AboutTab + KvCacheCard) ; PressFeedsManager 555→140 l.
  (PressFeedEditor, PressFeedList, SourcePicker, pressFeedsUi). L'onglet
  À propos n'annonce plus LanceDB (jamais livré).
- **pressDigest éclaté par étape** : digestLlm (plomberie commune),
  journalAnalysis, detailVerification (anti-invention), globalSynthesis —
  pressDigest garde l'orchestration et réexporte tout (aucun importeur touché,
  38 tests inchangés).

**Clôture du plan (même session)** — les deux derniers chantiers
automatisables sont faits :

- **Rust net** : les 12 warnings clippy purgés (stubs screen annotés contrat
  IPC, module updater release-only, champ `recursive` mort retiré de
  DirListArgs, `Iterator::find`, etc.) ; la CI exécute désormais
  `cargo clippy --lib --tests -- -D warnings` — tout nouveau warning casse
  le build.
- **Tests composants React** : testing-library + jsdom posés (pragma
  par fichier, les tests purs restent en node) — 13 tests sur PressFeedList
  (confirmation 2 clics), PressFeedsManager (backend fake : validations,
  création de bout en bout) et SettingsWindow (4 onglets, garde anti-LanceDB).
  **Desktop : 21 tests.**

Reste à faire (nécessite un humain) : vérification manuelle end-to-end
(`pnpm dev`) — chat 2 conversations, permission accordée qui ferme le prompt,
ligne FILE_WRITE dans l'audit, refus français sur C:\Windows, dashboard,
dailys.

---

### État antérieur (2026-07-15)

**Refactoring de fond (2026-07-15)** — audit complet noté 12/20, puis 6 phases
exécutées (comportement produit inchangé, **557 tests TS verts / 71 fichiers +
22 tests Rust**) :

- **Outillage** : `tsconfig.base.json` partagé, ESLint 9 flat config racine
  couvrant les 3 packages (avant : desktop seul), hook husky pre-commit réel,
  CI corrigée (déclenchée sur `master` — elle visait main/dev et ne tournait
  jamais —, job Rust fmt+tests sur windows-latest épinglé 1.96, job Python qui
  compile vraiment les modules, « Bundle Size Check » no-op remplacé par le
  build esbuild de l'agent), LICENSE MIT ajoutée, README corrigé (LanceDB →
  vector store maison cosinus/JSON).
- **Sécurité Rust** : `sandbox::check_path` canonicalise (crate `dunce`,
  ancêtre existant pour les cibles à créer, rejet `..` non résolu) et compare
  par composants — le contournement par préfixe voisin (`c:\users\alexiX`) et
  les symlinks sont fermés ; les appelants utilisent le chemin canonique
  retourné. Audit systématique : `audit::log(event, json)` (même format que
  l'AuditLogger Node) appelé après `file_write`, `clipboard_write`,
  `open_application`, `permission_respond` (avant : seul `run_command`).
  Plus de `.expect()` sur les pipes du sidecar.
- **Outils agent** : enregistrement extrait dans `tools/registerTools.ts` +
  test de cohérence outils ↔ `DEFAULT_PERMISSION_CONFIG` (4 permissions
  orphelines purgées : close_window, send_keys, delete_file, run_as_admin).
  Validation **zod** opt-in dans `BaseTool<A>` (`run()` = safeParse puis
  execute) branchée sur le lot 1 — les 12 outils dangereux
  (filesystem/system/infra) valident désormais les arguments du LLM ; leur
  schéma zod est LA source unique (`jsonSchemaFrom`), entrées retirées de
  `TOOL_SCHEMAS`. Lots 2-4 (git/web/connecteurs/reste) : à migrer au fil de
  l'eau sur le même pattern.
- **Contrat IPC** : `shared-types/src/ipc-contract.ts` (11 événements Tauri +
  10 méthodes RPC + 6 notifications) avec miroir Rust `ipc/protocol.rs` vérifié
  par un test cargo `include_str!` anti-dérive ; helpers
  `rpc_request`/`rpc_notification` remplacent les 9 enveloppes JSON-RPC
  copiées-collées. Corrélation d'IDs fiabilisée de bout en bout :
  `buildStepNotification` (testé) garantit conversationId/messageId sur chaque
  step, le bridge Rust n'invente plus `default`/`unknown`, et les heuristiques
  de repli de `chatStore` sont supprimées. `send_to_agent(payload)` a perdu ses
  paramètres morts.
- **Config centrale agent** : `src/config.ts` (charge le .env puis fige tout —
  modèles, URL Ollama, timeouts, flags) ; plus de `qwen3:14b` en dur ×3 ni de
  `Number(env)` → NaN silencieux. `OllamaClient.embed()` a un timeout 30 s +
  1 retry (`lib/retry.ts`) — plus de gel du pipeline embeddings. Stores SQLite
  typés (`lib/sqljs.ts` partagé, fini les `db: any` ×4).

**Phases 6-9 (même session)** — état final : **560 tests agent-runtime +
8 tests desktop + 5 tests Python + 22 tests Rust, lint 0 warning** :

- **Frontières** : `chat.rs` éclaté en `commands/press.rs` (5 cmd) et
  `commands/models.rs` (Ollama + VRAM) — aucun renommage de commande. Couche
  API React `src/shared/api/` (chat, models, settings, permissions, market,
  press) : plus aucun `invoke()` hors de cette couche, verrouillé par la règle
  ESLint `no-restricted-imports`. **Bug corrigé au passage** :
  `permission_respond` attendait `{args:{…}}` mais le front envoyait les clés
  à plat — la réponse aux prompts de permission échouait.
- **Agent** : system prompt extrait en `prompts/systemPrompt.ts` (pur, testé) ;
  helpers `lib/runProcess.ts` + `lib/git.ts` (GitCommitTool et
  SummarizeGitLogTool migrés, le reste au fil de l'eau).
- **Front** : vitest posé sur apps/desktop ; `DailyRow`/`rowToDaily`
  dédupliqués dans `features/dailies/model.ts` ; logique métier de
  PressFeedsManager extraite dans `pressFeedsModel.ts` (parsing CSV/lignes,
  validation regex, brouillon ↔ modèle — 8 tests) ; les 3 warnings
  `exhaustive-deps` corrigés (loadModels, commands mémoïsé, toggle).
- **Python** : socle pytest (dispatcher JSON-RPC + parse_csv_file, 5 tests),
  `requirements-dev.txt`, le job CI exécute enfin compileall + pytest.
  NB : le `.venv` était endommagé (pip/pywin32/chardet amputés) — réparé via
  `pip --python` ; refaire `scripts/setup.ps1` si d'autres modules manquent.

---

### État antérieur (2026-07-07)

Dailys : le pipeline télécharge désormais le CORPS de chaque article
(`enrichArticleTexts`, ~1 500 c/article, budget adaptatif dans l'invite) et le
LLM rédige un paragraphe détaillé par article, replié derrière « En savoir
plus » dans le widget (blockquote Markdown imbriqué sous la puce, retiré côté
Discord). Fix critique au passage : les appels LLM de digest étaient tués par
le timeout global de 120 s (cause des dailys « extraits bruts en anglais ») —
ils ont maintenant num_ctx 8192 + 10 min de budget (DIGEST_LLM_OPTS).
Garde-fou anti-invention sur les détails : couche 1 déterministe (tout nombre
du détail doit exister dans la source), couche 2 vérificateur LLM à
température 0 (rejette noms/faits absents de l'article). Validé en réel :
substitution de nom et chiffre inventé rejetés, détail fidèle conservé (3/3).
**Couverture garantie** (`ensureVerifiedDetails`) : un détail rejeté ou
manquant est régénéré article par article (contexte mono-article, feedback,
3 tentatives), puis repli verbatim « Extrait de l'article : "…" » — chaque
article a TOUJOURS son « En savoir plus », jamais un texte inventé.
Modèle des digests : la prod tourne sur qwen3:14b (choix VRAM du launcher,
bridge.rs) — son mode raisonnement est désormais coupé (`think:false` dans
DIGEST_LLM_OPTS, traversant OllamaClient). C'était l'autre cause des
timeouts. Validé en réel : 122 s tout compris, 5/5 détails vérifiés, qualité
nettement au-dessus du 7B, zéro résidu de thinking.
67 outils agent enregistrés (filesystem, système, web, navigateur Playwright,
git, GitHub, écran/OCR, audio, mémoire, sous-agents, cron, analyse, bourse,
connecteurs). Stack Tauri 2 + React 19 + Node agent-runtime + sidecar Python.
Plateforme dashboard livrée sur `feat/dashboard-platform` : widgets
configurables, bourse live (Yahoo + formules mathjs), news/dailys Supabase
avec console admin, revue de presse auto (cron + LLM), miroir Discord.
Mémoire hiérarchique (warm store + consolidation), cache sémantique, playbook
auto-évolution et spiral monitor câblés dans `index.ts`.
Le monorepo type-check intégralement — **458 tests verts (65 fichiers)**.

## Travail — Session 2 (2026-06-11)

**Objectif** : continuer le développement après un gros build parallèle qui
avait remplacé une partie des ajouts de la session 1.

- [x] Vérifié la cohérence post-refactor : type-check complet ✅, fichier
      orphelin `ipc/OcrSidecarClient.ts` confirmé supprimé.
- [x] **VectorStore réel** — c'était le principal trou fonctionnel (stub
      renvoyant `[]`). Réécrit dans `packages/agent-runtime/src/memory/VectorStore.ts` :
  - embeddings Ollama (`nomic-embed-text`) quand disponible
  - similarité cosinus en mémoire (pas de binding natif type LanceDB)
  - persistance disque `<dataDir>/vectors.json`
  - repli mots-clés automatique si embeddings indisponibles
  - **testé** : repli (score 0.4 sur la bonne entrée) + persistance après reload ✅
- [x] Embedder (OllamaClient) injecté dans `VectorStore` via `index.ts`
      (ordre de création réorganisé : llm avant vectorStore).
- [x] Re-câblé `keep_alive` + `num_ctx` dans `OllamaClient` (perdus au refactor).

**Impact** : `search_memory`, `store_memory`, `semantic_search` ne sont plus des
coquilles vides — la mémoire fonctionne (repli mots-clés actif tout de suite).

**Pour activer la recherche 100 % sémantique** : `ollama pull nomic-embed-text`
(seul `qwen2.5:7b` présent actuellement).

## Tests automatisés — premier socle (2026-06-11)

Le projet n'avait **aucun test**. Socle vitest posé (3 fichiers, **23 tests verts**) :

- [x] `memory/VectorStore.test.ts` (7) — repli mots-clés, sémantique (embedder
      factice déterministe), persistance, delete, filtre métadonnées.
- [x] `tools/analysis/AnalyzeStacktraceTool.test.ts` (7) — détection
      Node/TS/Python/Rust/Java, type/message d'erreur, frames internes, cause racine.
- [x] `CronScheduler.test.ts` (9) — `parseScheduleMs` (alias, "every N u",
      casse, invalides) + validation `addJob`/`cancelJob`.

Lancer : `pnpm --filter @catdesk/agent-runtime test`.

## Routeur de modèles — câblé (2026-06-11)

- [x] `llm/ModelRouter.ts` recréé (heuristique simple, testable).
- [x] Câblé dans `AgentOrchestrator` en **downgrade-only** : `large` = modèle
      choisi par l'UI, rétrograde vers `small` seulement pour les tâches triviales
      (sans outils, courtes, sans indice de complexité). Décision prise une fois
      par run, journalisée.
- [x] Activé via `CATDESK_MODEL_SMALL` (absent => aucun routage, comportement
      inchangé). Non-breaking.
- [x] `llm/ModelRouter.test.ts` (7 tests).

**Total tests : 30 verts (4 fichiers).**

## Extension des tests — git & web (2026-06-11)

- [x] Exporté les helpers purs `inferCommitType` / `inferScope` (GitCommitTool)
      et `htmlToText` / `extractBySelector` (ReadWebpageTool) pour les rendre
      testables (aucun changement de comportement).
- [x] `GitCommitTool.test.ts` (13) — inférence Conventional Commits (type + scope).
- [x] `ReadWebpageTool.test.ts` (11) — htmlToText (entités, blocs, scripts),
      sélecteur naïf, et garde-fous de `execute` (url invalide, protocole).
- [~] Un test a révélé la limite assumée du sélecteur `#id` (s'arrête au 1er
  `</`) → assertion ajustée + commentée (code laissé tel quel, naïveté voulue).

**Total tests : 54 verts (6 fichiers).**

## Boucle plan→exécute (opt-in) — 2026-06-11

- [x] `AgentConfig.usePlanning?: boolean` (opt-in, défaut off).
- [x] `llm/Planner.ts` : `parsePlan` (pur) + `Planner.plan()` (réutilise
      `streamChat`, sans nouvel endpoint, échec silencieux → plan vide).
- [x] Câblé dans `AgentOrchestrator` : si `usePlanning`, génère le plan une fois
      et l'injecte comme guidage dans le system prompt. **Aucun nouveau type
      d'AgentStep → zéro changement Rust**, totalement non-breaking.
- [x] `Planner.test.ts` (7) : parsing listes numérotées/puces, préambule ignoré,
      repli lignes, plafond 8 étapes.

**Total tests : 61 verts (7 fichiers).**

## Plan visible dans l'UI — 2026-06-11 (4 couches)

- [x] Types : `{ type: 'plan'; steps: string[] }` ajouté à `AgentStep` ;
      `plan?: string[]` ajouté au type `Message`.
- [x] Orchestrateur : `yield { type: 'plan', steps }` quand un plan est généré.
- [x] Bridge Rust : nouveau bras `"plan"` → émet l'event `agent:plan`
      `{ conversationId, messageId, steps }`.
- [x] React : `useTauriEvents` écoute `agent:plan` → `chatStore.setPlan`
      (rattaché au message en cours de streaming, robuste au routage d'id) ;
      `MessageItem` affiche un encart « 📋 Plan » au-dessus de la réponse.
- [x] Type-check des 3 packages OK. (Rust non `cargo build` — ajout minimal
      calqué sur les bras existants.)

## Swap de modèles léger ↔ heavy-code — 2026-06-11

- [x] `AgentConfig` : `modelMode` ('auto'|'light'|'code') + `lightModel` + `codeModel`.
- [x] `resolveModel()` (pur, dans ModelRouter) : light/code forcent ; auto route
      via `ModelRouter` (small=light, large=code). +6 tests (67 au total).
- [x] `AgentOrchestrator.pickModel()` utilise `resolveModel`.
- [x] Rust : `ChatSendArgs` + payload transmettent mode/light/code/planning.
- [x] React : store (`modelMode`/`lightModel`/`codeModel` + `setModelMode`),
      `ModeSelector` (Auto / Léger / Code) dans le header du chat, transmis au
      `chat_send`.
- [~] Pull `qwen2.5-coder:14b` lancé en arrière-plan (~9 Go, lent). « Code »
  l'utilisera dès qu'il sera disponible. Défauts : light=`qwen2.5:7b`,
  code=`qwen2.5-coder:14b`.
- [x] Type-check 3 packages OK.

## Vision / écran (a) — 2026-06-11

- [x] **Environnement installé** : Python 3.12 (scope user), venv
      `packages/ocr-vision/.venv` + deps capture/OCR (mss, pytesseract, Pillow,
      pywin32, numpy), Tesseract 5.4 (winget). `fra` indispo en écriture dans
      Program Files → dossier utilisateur `%LOCALAPPDATA%\nd-tessdata`
      (eng+fra+osd) pointé par `TESSDATA_PREFIX`.
- [x] `lib/ocrSidecar.ts` : passe `TESSDATA_PREFIX` au spawn du sidecar.
- [x] **OCR testé live** : capture réelle + lecture du texte de l'écran à ~80 %
      de confiance (FR+EN).
- [x] `describe_screen` (vision) : capture + description via modèle multimodal
      (`CATDESK_VISION_MODEL`, défaut `llava:7b`), image jointe au message.
      Schéma + permission + enregistrement. Type-check OK, 67 tests verts.
- [~] `llava:7b` en cours de pull (~4,1 Go). Description visuelle testable à la fin.

## Navigateur pour pages JS (b) — 2026-06-11

- Prérequis OK : `playwright-core` installé + Chrome/Edge système détectés
  (`browserManager` lance le navigateur système, pas de Chromium à télécharger).
- [x] `read_webpage` : détecte une **SPA** (HTML volumineux, texte quasi nul) et
      renvoie `likelySpa: true` + un `hint` orientant vers `browser_navigate` +
      `browser_get_text`. Description mise à jour (HTTP simple, sans JS).
- [x] Descriptions `browser_navigate` / `browser_get_text` clarifiées (pages
      JS/SPA, astuce `wait_until="networkidle"`).
- Résultat : sur une page comme gameslantern (SPA), l'agent reçoit un signal
  explicite pour basculer sur le navigateur qui exécute le JS.

## Prochaines pistes (par valeur)

1. ⬜ Persister le mode/les modèles choisis (settings) entre sessions.
2. ⬜ Réduire la friction : `browser_navigate` est en risk `high` (confirmation).
3. ⬜ Implémenter la capture écran côté Rust (`screen.rs` stub) OU assumer que
   tout passe par le sidecar Python.
4. ⬜ Packaging / distribution.

_Aucun commit effectué — tout est dans l'arbre de travail._
_(Note 2026-07-02 : obsolète — tout a été commité depuis sur `feat/dashboard-platform`.)_

## Hygiène du repo — Session 3 (2026-07-02)

Audit complet du projet, puis corrections :

- [x] Docs resynchronisées avec la réalité du code : compte d'outils (57→62),
      état actuel ci-dessus, [LIMITES.md](LIMITES.md) §4 (mémoire warm et RAG
      hybride BM25 sont câblés), CHANGELOG réellement rempli,
      [CATDESK-CONCEPTS-AVANCES.md](../CATDESK-CONCEPTS-AVANCES.md) annoté avec
      l'état d'implémentation par section.
- [x] PR #1 (`feat/dashboard-platform`, 32 commits) mergée dans `master`.
- [x] Outil orphelin `analyze_logs` (branche `feat/analyze-logs-tool`, complet + testé mais jamais intégré) rapatrié dans `master`.
- [x] Branches mortes supprimées (0 commit unique) ; `dev` remise au niveau de
      `master`.
- Vérifié au passage : `build-dist/` n'est **pas** tracké par git (bien ignoré),
  et les modules « avancés » (warm memory, cache sémantique, EvolutionDaemon,
  SpiralMonitor) sont tous réellement branchés dans `index.ts` — pas de code mort.

## Phase 1 — les 4 outils manquants (2026-07-03)

Les 4 actions qui avaient une fiche de permission sans outil câblé
(LIMITES.md §1) sont maintenant implémentées, testées et enregistrées :

- [x] `write_file` — écrit/append UTF-8 ou base64, crée les dossiers parents,
      **bloque les répertoires système** (Windows, Program Files, ProgramData),
      plafond 5 Mo. 10 tests.
- [x] `write_clipboard` — Set-Clipboard via fichier temporaire UTF-8 (accents
      préservés, zéro problème de quoting). Tests de validation (le vrai
      presse-papier n'est pas touché par la suite).
- [x] `open_app` — Start-Process avec échappement PowerShell anti-injection,
      validation du nom (caractères de contrôle interdits). 6 tests.
- [x] `store_memory` — VectorStore.store avec métadonnées source/tags/date ;
      la mémoire est enfin inscriptible par l'agent. 5 tests.

**67 outils · 458 tests verts (65 fichiers)** · type-check OK.
Reste en « pas câblé » : `close_window`, `send_keys` (🟠) et les deux 🔴
volontairement désactivés.

## B6 + tests sandbox (2026-07-03)

- [x] **B6 — persistance SQLite de l'historique bourse** :
      `market/MarketHistoryStore.ts` (sql.js, `data/market.db`) — append par
      tick du poller, réamorçage de l'historique au démarrage, purge quand un
      symbole quitte la watchlist, plafond par symbole
      (`CATDESK_MARKET_HISTORY_CAP`, défaut 2880 ≈ 24 h à 30 s). Échec d'init
      non-fatal (repli mémoire pure). 9 tests. Débloque les formules
      glissantes (B1).
- [x] **Tests Rust de `sandbox.rs`** — la barrière de sécurité du projet
      n'avait aucun test : 8 tests couvrent la blocklist de commandes
      (destructives + évasion PowerShell + insensibilité à la casse + longueur
      max), le path traversal et les racines autorisées (USERPROFILE/temp).
      `cargo test --lib` : **15 verts** (avec tuning.rs).

**Node : 467 tests (67 fichiers) · Rust : 15 tests** · type-check OK.

## B1 — formules glissantes (2026-07-03)

- [x] `FormulaEngine.buildScope` accepte l'historique : chaque symbole expose
      `X.history` (série de prix), et le scope gagne `sma(serie, n)` /
      `ema(serie, n)`. Exemples : `sma(AAPL.history, 20)`,
      `AAPL.price - sma(AAPL.history, 50)`, `max(MSFT.history)`.
- [x] Fenêtre en mémoire : 120 points (~1 h à 30 s) ; réamorcée depuis SQLite
      (B6) au démarrage — les moyennes ne repartent plus de zéro.
- [x] Guide widgets (PDF) et CAPACITES mis à jour ; B1 + B6 cochés au backlog.

**Node : 471 tests (67 fichiers) · Rust : 15** · type-check OK.
