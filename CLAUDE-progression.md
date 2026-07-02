# CatDesk — Contexte projet pour Claude Code

> Copilote desktop local 100% on-device · Ollama · Rust · Windows

---

## Stack technique actuelle

| Couche | Techno |
|---|---|
| LLM | Ollama (local, aucune donnée cloud) |
| Shell/sandbox | Rust — chaque chemin/commande validé avant exécution |
| Permissions | `low=auto · medium=1 fois · high=confirmation · critical=désactivé` |
| Audit | Chaque appel d'outil est journalisé |
| Mémoire | Vectorielle — préférences et projets persistés entre sessions |

---

## Capacités disponibles (✅)

> 63 outils enregistrés dans l'agent runtime (`packages/agent-runtime/src/index.ts`).

**Perception**
- Lecture fichiers (code, configs, logs) — `read_file`, `list_dir`
- Lecture presse-papier — `read_clipboard`
- Lecture d'écran : capture + OCR Tesseract + description vision (llava) — `capture_screen`, `ocr_region`, `describe_screen`
- Lecture de page web — `read_webpage` (+ steering vers les outils browser pour pages JS/SPA)
- Transcription audio locale (Whisper / faster-whisper, CPU int8) — `transcribe_audio`
- Lecture de documents locaux : PDF / Word (.docx) / CSV — texte + métadonnées, 100% local — `parse_document`
- Analyse de tableaux locaux CSV/Excel : profil + stats + agrégation `group_by` (pandas) — `analyze_data`
- Génération de documents : Markdown/texte → PDF / Word (.docx) / HTML / Markdown (xhtml2pdf + python-docx) — `export_document`
- Lecture de calendrier local .ics : événements sur une fenêtre de dates, récurrences développées — `read_calendar`

**Code & Git**
- Analyse de stacktrace (cause racine + fix) — `analyze_stacktrace`
- Génération de tests unitaires (vitest/jest/pytest/cargo/go) — `generate_unit_tests`
- Refactoring guidé (détection d'opportunités) — `suggest_refactor`
- Génération de commit message (Conventional Commits depuis le diff stagé) — `generate_commit_message`
- Génération de PR/MR — `generate_pr_description`
- Review de diff (secrets, debug, conflits, eval…) — `review_diff`
- Analyse de dépendances (npm/cargo/pip) — `analyze_dependencies`
- Résumé git log (type/auteur/scope) — `summarize_git_log`
- Résolution de conflits (ours/theirs) — `resolve_conflicts`
- Bisect guidé (commit cassant) — `bisect_guided`
- Agent de CI (poll GitHub Actions) — `watch_ci`
- Recherche sémantique locale dans le code — `semantic_search`

**Connecteurs**
- GitHub : issues + pull requests — `github_issues`, `github_pr`
- Obsidian (coffre local) + Notion (API) — `obsidian_notes`, `notion_search`
- Discord / Slack (webhook sortant) — `send_webhook_message`
- Client REST/JSON générique (sites perso, API, MCP local) — `call_api`
- Email IMAP (lecture seule) : liste de la boîte + lecture d'un message — `read_email`
- Browser automation (Chrome) : navigate, click, type, get_text, screenshot, close — 6 outils `browser_*`

**Système & infra**
- Lancement de commandes PowerShell/cmd avec sandbox Rust — `run_command`
- Audit des variables d'environnement (.env vs .env.example) — `audit_env`
- Monitoring de ports + kill de process — `inspect_port`, `kill_process`
- Docker : liste/logs + start/stop/compose — `docker_ps`, `docker_control`
- Base SQLite locale (lecture seule par défaut) — `run_sqlite`
- Bases Postgres / MySQL-MariaDB : lecture seule par défaut + transaction READ ONLY au niveau SGBD — `query_database`
- Mémoire vectorielle inter-sessions (VectorStore réel) — `search_memory`

**Agents & automatisation**
- Sous-agents (isolés) + sous-agents parallèles — `run_subagent`, `run_parallel_agents`
- Cron natif : planifier / lister / annuler des tâches — `schedule_task`, `list_scheduled_tasks`, `cancel_scheduled_task`

**Productivité & apprentissage**
- Détection de spirale en arrière-plan (ActivityTracker → SpiralMonitor → bannière proactive) — `detect_spiral`
- Résumé de standup (hier/aujourd'hui/blocages) — `generate_standup`
- Profil de style de code du projet — `analyze_code_style`
- Mémoire de projet (contexte à l'ouverture) — `load_project_context`

**Orchestration**
- Boucle plan-then-execute (Planner) avec affichage du plan dans le chat
- Sélecteur de modèle : Auto / Light / Code (heavy) via ModelRouter

---

## Références architecture

### Hermes Agent (NousResearch)
Repo : `github.com/NousResearch/hermes-agent` — v0.16 "The Surface Release" (juin 2026)
Agent open-source le plus proche de CatDesk en esprit. À éplucher pour :
- **Skills System** : documents de connaissance chargés à la demande, compatible `agentskills.io`
- **Browser automation** : Chrome local via CDP, ou cloud Browserbase
- **Sous-agents parallèles** : spawn d'instances isolées pour workstreams parallèles
- **Auto-évolution** : `hermes-agent-self-evolution` (DSPy + GEPA) optimise les skills depuis les traces réelles
- **Cron natif** : automations planifiées sans supervision
- ⚠️ Windows natif expérimental → WSL2 requis

### MCP (Model Context Protocol)
Standard ouvert Anthropic → Linux Foundation. "USB-C pour outils IA."
Chaque app/site devient un serveur MCP local. Ollama les appelle comme des outils natifs.

```
App avec API  → REST API → serveur FastMCP local → outil Ollama
App sans API  → browser automation (Chrome CDP / Playwright) → extraction
```

Libs clés : `FastMCP` (Python) · `mcphost` · `mcpo` (proxy MCP→OpenAPI)

---

## Roadmap complète

### 01 — Lecture & perception

| Feature | Statut | Priorité | Notes |
|---|---|---|---|
| Lire tes fichiers | ✅ dispo | — | `read_file`, `list_dir` |
| Lire le presse-papier | ✅ dispo | — | `read_clipboard` |
| Lire l'écran (OCR) | ✅ dispo | — | `capture_screen` + `ocr_region` (Tesseract) + `describe_screen` (vision llava) |
| Lire une page web | ✅ dispo | — | `read_webpage` ; pages JS/SPA → outils `browser_*` |

### 02 — Intelligence de code

| Feature | Statut | Priorité | Notes |
|---|---|---|---|
| Analyse de stacktrace | ✅ dispo | — | `analyze_stacktrace` — cause racine + ligne + fix |
| Génération de commit message | ✅ dispo | — | `generate_commit_message` — diff stagé → Conventional Commits |
| Génération de PR/MR | ✅ dispo | — | `generate_pr_description` — titre + description |
| Génération de tests unitaires | ✅ dispo | — | `generate_unit_tests` — détecte vitest/jest/pytest/cargo/go, extrait les exports, scaffold + chemin de test |
| Refactoring guidé | ✅ dispo | — | `suggest_refactor` — fonctions longues, trop de params, imbrication, duplication, lignes/fichier trop longs |
| Review de diff | ✅ dispo | — | `review_diff` — secrets, marqueurs de conflit, eval, debug oublié, `.only`, `any`, TODO (working tree / staged / vs branche) |
| Analyse de dépendances | ✅ dispo | — | `analyze_dependencies` — package.json/Cargo.toml/requirements.txt → wildcard/pré-1.0/prerelease/non-registry + cmd de check live |
| Bisect guidé | ✅ dispo | — | `bisect_guided` — compte les commits suspects (good..bad), point milieu, nb d'étapes, commandes manuelles + `git bisect run` |

### 03 — Git & workflow

| Feature | Statut | Priorité | Notes |
|---|---|---|---|
| Agent de CI | ✅ dispo | — | `watch_ci` — poll GitHub Actions → résume erreurs build |
| Résumé git log | ✅ dispo | — | `summarize_git_log` — par type/auteur/scope + fichiers chauds, filtres since/path/author |
| Résolution de conflits | ✅ dispo | — | `resolve_conflicts` — décompose les conflits en blocs ours/theirs (+base diff3), lecture seule |

### 04 — Connecteurs MCP (apps & sites)

Principe : un serveur FastMCP local par app. Ollama l'appelle comme outil natif.

| Connecteur | Statut | Priorité | Stack |
|---|---|---|---|
| GitHub | ✅ dispo | — | Outils natifs `github_issues` + `github_pr` (API directe, pas encore MCP) |
| Filesystem | ✅ dispo | — | Outils natifs `read_file` / `list_dir` + sandbox Rust (pas encore exposé en MCP) |
| Obsidian / Notion | ✅ dispo | — | `obsidian_notes` (coffre local, sans réseau) + `notion_search` (API Notion : recherche + lecture page) |
| Discord / Slack | ✅ dispo | — | `send_webhook_message` — webhook entrant Discord/Slack (sortant, confirmation requise) |
| Email (IMAP) | ✅ dispo | — | `read_email` — lecture seule : liste de la boîte (filtres unseen/since/search) + lecture d'un message par UID ; identifiants via args ou env IMAP_* (high, confirmation) |
| Calendrier local (.ics) | ✅ dispo | — | `read_calendar` — lit un fichier .ics, fenêtre de dates, récurrences développées, 100% local (sans OAuth) |
| Google Calendar | ⬜ prévu | moyenne | OAuth + FastMCP (flux OAuth à câbler) — alternative cloud du `read_calendar` local |
| Linear / Jira | 🟡 via `call_api` | moyenne | Accessible via le client REST générique ; tool dédié possible plus tard |
| Tes sites perso (API) | ✅ dispo | — | `call_api` — client REST/JSON générique (GET/POST/PUT/PATCH/DELETE, Bearer, https + http localhost) |
| Sites sans API | ✅ dispo | — | Browser automation Chrome — `browser_navigate/click/type/get_text/screenshot/close` |
| Spotify | ⬜ prévu | basse | Contrôle musique (OAuth à câbler) |
| Composio (agrégateur) | ⬜ prévu | optionnel | 1 URL MCP → 1000+ apps, auth auto |

### 05 — Environnement & infra

| Feature | Statut | Priorité | Notes |
|---|---|---|---|
| Docker / Compose | ✅ dispo | — | `docker_ps` (liste + logs) + `docker_control` (start/stop/restart, compose up/down) |
| Monitoring de ports | ✅ dispo | — | `inspect_port` (qui écoute sur un port + process) + `kill_process` (libère le port) |
| Variables d'environnement | ✅ dispo | — | `audit_env` — .env vs .env.example, secrets, valeurs vides, alerte gitignore |
| Base de données locale | ✅ dispo | — | `run_sqlite` — SQL sur SQLite local, lecture seule par défaut (garde anti-écriture + multi-statement) |
| Bases SQL serveur (Postgres/MySQL) | ✅ dispo | — | `query_database` — Postgres + MySQL/MariaDB, lecture seule par défaut (garde + transaction READ ONLY au niveau SGBD), connexion via DSN ou env |
| Lecture/analyse de documents & données | ✅ dispo | — | `parse_document` (PDF/Word/CSV → texte+méta) · `analyze_data` (CSV/Excel → profil/stats/agrégation pandas), 100% local |
| Génération de documents | ✅ dispo | — | `export_document` — Markdown/texte → PDF/Word/HTML/Markdown (xhtml2pdf + python-docx), écrit sur disque (confirmation), 100% local |

### 06 — Agents & automatisations

| Feature | Statut | Priorité | Notes |
|---|---|---|---|
| Sous-agents parallèles | ✅ dispo | — | `run_subagent` + `run_parallel_agents` (SubAgentRunner) |
| Cron / agent de veille | ✅ dispo | — | `schedule_task` / `list_scheduled_tasks` / `cancel_scheduled_task` (CronScheduler) |
| Skills auto-évolutifs | ⬜ prévu | moyenne | DSPy + GEPA sur traces (ref: hermes-agent-self-evolution) |
| Planificateur de tâches | 🟡 partiel | basse | Boucle plan-then-execute (Planner) en place ; checkpoints à venir |

### 07 — Vie quotidienne

| Feature | Statut | Priorité | Notes |
|---|---|---|---|
| Transcription de réunion | 🟡 partiel | 🔥 #4 | `transcribe_audio` (Whisper local) dispo ; capture micro live + action items à venir |
| Détection de spirale | ✅ branché | — | `detect_spiral` + boucle live : `ActivityTracker` (observe les outils) → `SpiralMonitor` (timer/cooldown) → event Tauri `proactive:suggestion` → bannière React |
| Pomodoro intelligent | ⬜ app | moyenne | Boucle d'arrière-plan de l'app (pas un outil d'agent) |
| Time tracking auto | ⬜ app | moyenne | Boucle d'arrière-plan de l'app (déduit depuis fichiers ouverts) |
| Résumé de standup | ✅ dispo | — | `generate_standup` — hier/aujourd'hui/blocages depuis l'activité git |
| Rappels ergonomie | ⬜ app | basse | Boucle d'arrière-plan de l'app (20-20-20, fatigue) |

### 08 — Apprentissage & personnalisation

| Feature | Statut | Priorité | Notes |
|---|---|---|---|
| Recherche sémantique locale | ✅ dispo | — | `semantic_search` dans le code du projet |
| Tip contextuel | 🟡 amorcé | 🔥 #8 | Boucle proactive en place (`SpiralMonitor` → bannière) ; reste à étendre aux patterns répétitifs hors spirale |
| Mémoire vectorielle | ✅ dispo | — | Préférences + projets inter-sessions |
| Profil de style de code | ✅ dispo | — | `analyze_code_style` — indentation, guillemets, point-virgules, camel/snake, longueur de ligne |
| Mémoire de projet | ✅ dispo | — | `load_project_context` — stack, scripts, structure, points d'entrée, résumé README |
| Feedback loop | ⬜ app | basse | 👍/👎 → ajuste prompts (intégration UI app) |

---

## Top 8 priorités (impact / effort)

| # | Feature | Statut | Justification | Effort estimé |
|---|---|---|---|---|
| 1 | Analyse de stacktrace | ✅ fait | Remplace 80% des recherches de debug | ~2j, no deps |
| 2 | Génération commit/PR | ✅ fait | Friction quotidienne la plus visible | ~1j, git diff |
| 3 | Agent de CI | ✅ fait | Élimine context-switch navigateur/IDE | ~3j, MCP |
| 4 | Transcription de réunion | 🟡 partiel | Corvée réelle + 100% privé (Whisper local) | ~4j, Whisper |
| 5 | Détection de spirale | ✅ fait | Différenciateur unique, personne d'autre ne fait ça | ~2j, heuristique |
| 6 | GitHub connector | ✅ fait (API directe) | Débloque issues/PRs sans quitter CatDesk | ~2j, FastMCP |
| 7 | Sous-agents parallèles | ✅ fait | Vrai saut architectural | ~1 sem, design |
| 8 | Tip contextuel | 🟡 brique | `detect_spiral` fournit le cerveau ; déclenchement = boucle app | ~2j, patterns |

**Bilan : 7/8 livrés, 1 partiel** (transcription) — le tip contextuel a sa brique (`detect_spiral`), reste son intégration dans la boucle d'arrière-plan de l'app.

---

## Conventions de développement

- Tout code potentiellement dangereux passe par la sandbox Rust existante
- Les permissions risk-gated sont non-négociables (low/medium/high/critical)
- Chaque nouvel outil = entrée dans le journal d'audit
- Aucune donnée ne part dans le cloud sauf recherche web déclenchée explicitement par l'utilisateur
- Les serveurs MCP tournent en local sur `127.0.0.1` uniquement

---

## Skills CatDesk

> Un skill = un document de connaissance chargé à la demande par l'agent, uniquement quand le contexte l'exige.
> Pattern : progressive disclosure — le skill ne charge que ce dont le tour courant a besoin.
> Compatible avec le standard `agentskills.io` (ref: Hermes Agent).
>
> Format recommandé : `~/.catdesk/skills/<nom>/SKILL.md`

---

### Catégorie A — Code & développement

#### `skill: debug-rust`
Chargé quand : erreur Rust détectée (borrow checker, lifetime, unsafe, panic).
Contenu :
- Patterns de lecture des messages d'erreur rustc (E0XXX)
- Recettes borrow checker : clone vs reference vs lifetime annotation
- Checklist panic : unwrap, index out of bounds, integer overflow
- Commandes utiles : `RUST_BACKTRACE=1`, `cargo check`, `cargo clippy -- -D warnings`
- Pièges courants avec async/await et `tokio`

#### `skill: debug-ts-nextjs`
Chargé quand : erreur TypeScript ou Next.js 15 détectée dans les fichiers du projet.
Contenu :
- Erreurs TS fréquentes : `Type 'X' is not assignable`, `cannot find module`, strict null checks
- Pièges Next.js 15 App Router : Server vs Client components, hydration mismatch, `use client` placement
- Debugging Tailwind CSS 4 : classes non appliquées, purge, dark mode
- Firebase auth + Firestore avec TypeScript : patterns de typage des documents

#### `skill: firebase-patterns`
Chargé quand : fichiers Firebase/Firestore ouverts ou mentionnés.
Contenu :
- Structure de règles Firestore sécurisées
- Patterns de requêtes paginées avec `startAfter`
- Gestion des transactions et batches
- Erreurs courantes : permissions denied, index manquant, offline persistence
- Pattern d'auth avec Next.js (SSR + cookies)

#### `skill: git-advanced`
Chargé quand : commandes git complexes demandées (rebase, cherry-pick, bisect, reflog).
Contenu :
- Rebase interactif : squash, fixup, reorder, drop
- Récupération depuis le reflog après une erreur
- Stratégies de merge vs rebase selon le contexte
- Cherry-pick avec conflits
- `git bisect` automatisé avec script de test
- Hooks pré-commit utiles

#### `skill: sql-debug`
Chargé quand : requête SQL lente ou incorrecte détectée.
Contenu :
- Lecture d'un `EXPLAIN ANALYZE`
- Anti-patterns de performance : N+1, SELECT *, JOIN sans index
- Recettes d'index : composite, partiel, covering
- Transactions : isolation levels, deadlocks, retry patterns
- Postgres spécifique : JSONB operators, window functions, CTEs

#### `skill: docker-compose`
Chargé quand : fichier `docker-compose.yml` ouvert ou commande docker lancée.
Contenu :
- Patterns de healthcheck fiables
- Networking inter-services : `depends_on` + condition
- Volumes nommés vs bind mounts : quand utiliser quoi
- Debug d'un container qui refuse de démarrer : `docker logs`, `docker exec`
- Recette docker-compose + Ollama local

#### `skill: api-design`
Chargé quand : création d'une nouvelle route REST ou GraphQL détectée.
Contenu :
- Conventions REST : nommage des routes, codes HTTP sémantiques, pagination cursor-based
- Validation de schéma : Zod (TS), Pydantic (Python)
- Gestion d'erreurs normalisée : format `{ error: { code, message, details } }`
- Auth : JWT stateless vs session, refresh token rotation
- Rate limiting : stratégies token bucket vs leaky bucket

---

### Catégorie B — Projet & organisation

#### `skill: ticket-writer`
Chargé quand : demande de créer un ticket, issue, ou user story.
Contenu :
- Template user story : `En tant que [rôle], je veux [action] afin de [bénéfice]`
- Critères d'acceptance SMART
- Format de bug report : contexte, reproduction, comportement attendu, logs
- Estimation en points : grille de référence (1/2/3/5/8/13)
- Checklist DoD (Definition of Done) par type de ticket

#### `skill: adr-writer`
Chargé quand : décision d'architecture à documenter.
Contenu :
- Template ADR (Architecture Decision Record) : contexte, décision, statut, conséquences
- Exemples de bonnes ADR (choix de techno, choix de pattern)
- Anti-patterns : ADR trop vague, ADR sans alternatives considérées

#### `skill: code-review`
Chargé quand : demande de review de code ou PR reçue.
Contenu :
- Checklist de review : sécurité, performance, lisibilité, testabilité, cohérence avec la codebase
- Ton constructif : distinguer "must fix" / "suggestion" / "nit"
- Patterns à refuser systématiquement : secrets hardcodés, SQL concatené, `any` en TS
- Règle des 5 min : si tu mets plus de 5 min à comprendre un bloc → demande un refacto

#### `skill: changelog-writer`
Chargé quand : création d'une release ou mise à jour du CHANGELOG.
Contenu :
- Format Keep a Changelog (`Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`)
- Extraction automatique depuis `git log --oneline vX.Y.Z..HEAD`
- Règle : le changelog s'adresse aux utilisateurs, pas aux développeurs
- Versioning sémantique : quand bump major/minor/patch

---

### Catégorie C — Communication & rédaction

#### `skill: email-tech`
Chargé quand : demande de rédiger un email technique ou une explication à un non-dev.
Contenu :
- Règle de l'email technique : une seule question/demande par email
- Vulgarisation d'une panne : chronologie → impact → cause → résolution → prévention
- Template d'escalade : urgence, impact business, actions déjà tentées
- Formules de politesse adaptées au contexte FR/EN professionnel

#### `skill: standup-format`
Chargé quand : demande de préparer un standup ou un compte-rendu de journée.
Contenu :
- Format standard : hier / aujourd'hui / blocages
- Extraction depuis git log + fichiers modifiés de la journée
- Règle : pas plus de 3 points par section
- Variante hebdomadaire pour les rapports d'alternance

#### `skill: presentation-structure`
Chargé quand : préparation d'une soutenance, demo, ou présentation technique.
Contenu :
- Structure en 3 actes : contexte → problème → solution
- Règle du "so what" : chaque slide doit répondre à "et alors ?"
- Gestion du temps : 1 min par slide en moyenne
- Checklist pré-démo : données de test prêtes, fallback offline, flow testé à froid

---

### Catégorie D — Recherche & veille

#### `skill: research-deep`
Chargé quand : recherche multi-sources demandée sur un sujet technique.
Contenu :
- Plan de recherche : définir la question précise → sources primaires → sources secondaires → synthèse
- Sources de référence par domaine : MDN (web), crates.io (Rust), PyPI (Python), RFC (protocoles)
- Vérification de la date des sources : méfiance pour tout > 18 mois sur les technos actives
- Recette de comparaison : tableau critères × options, pondéré selon le contexte projet

#### `skill: security-check`
Chargé quand : code de sécurité sensible détecté (auth, crypto, upload, input utilisateur).
Contenu :
- OWASP Top 10 : injection, broken auth, XSS, IDOR, misconfiguration
- Checklist input utilisateur : validation, sanitisation, longueur max, type enforcement
- Secrets : jamais dans le code, `.env` dans `.gitignore`, rotation régulière
- Headers HTTP de sécurité : CSP, HSTS, X-Frame-Options
- Dépendances : `npm audit`, `cargo audit`, `pip-audit`

#### `skill: perf-profiling`
Chargé quand : problème de performance détecté ou rapport de profiling fourni.
Contenu :
- Lecture d'un flamegraph : identifier les hot paths
- Métriques clés : Time to First Byte, LCP, CLS (web) / latence p99, throughput (API)
- Outils par stack : `cargo flamegraph`, Chrome DevTools perf, `clinic.js` (Node)
- Règle des 80/20 : optimiser d'abord ce qui est appelé le plus souvent
- Pièges classiques : allocation excessive, re-renders inutiles, requêtes N+1

---

### Catégorie E — Vie de dev au quotidien

#### `skill: focus-mode`
Chargé quand : session de travail longue démarrée ou Pomodoro activé.
Contenu :
- Protocole d'entrée en focus : fermer notifications, définir l'objectif unique de la session
- Règle de la spirale : si >30 min sur le même problème → changer d'approche ou demander de l'aide
- Gestion des interruptions : note rapide, retour au focus sans perte de contexte
- Fin de session : commit de sauvegarde, note du next step, déconnexion propre

#### `skill: onboarding-projet`
Chargé quand : nouveau dossier de projet ouvert pour la première fois.
Contenu :
- Checklist d'exploration : README, CONTRIBUTING, structure des dossiers, scripts disponibles
- Questions à répondre en 10 min : stack, point d'entrée, comment lancer en dev, comment tester
- Extraction du contexte : dépendances principales, patterns utilisés, conventions de nommage
- Création automatique de la note de projet dans la mémoire vectorielle

#### `skill: cleanup-session`
Chargé quand : fin de journée ou demande de nettoyage de l'environnement.
Contenu :
- Checklist de fin de session : branches mergées supprimées, stash vidé, TODO commentés tracés en ticket
- Nettoyage Docker : volumes orphelins, images inutilisées (`docker system prune`)
- Fichiers temporaires : patterns à supprimer par stack (`.DS_Store`, `node_modules`, `target/`)
- Résumé de session : commits du jour, fichiers modifiés, temps estimé par tâche

#### `skill: learn-shortcut`
Chargé quand : action répétitive détectée (3 fois le même pattern manuel).
Contenu :
- Principe : détecter → proposer une seule fois → ne plus répéter
- Raccourcis VS Code à fort ROI : multi-cursor, rename symbol, quick fix
- Aliases shell utiles à créer selon l'usage détecté
- Règle : ne jamais interrompre le flow pour un tip — attendre la fin de la tâche en cours

---

### Format d'un skill CatDesk

```
~/.catdesk/skills/
├── debug-rust/
│   └── SKILL.md          # Contenu du skill
├── git-advanced/
│   └── SKILL.md
└── focus-mode/
    └── SKILL.md
```

Chaque `SKILL.md` suit ce squelette :

```markdown
# SKILL: <nom>

## Déclencheurs
- Conditions qui font charger ce skill (extensions de fichiers, mots-clés, contexte)

## Contenu principal
[Corps du skill — recettes, checklists, patterns]

## Commandes de référence
[Commandes shell/CLI directement utilisables]

## Voir aussi
- skill: <nom-skill-lié>
```
