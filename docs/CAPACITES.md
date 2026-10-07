# CE QUE CATDESK SAIT FAIRE

> Document unique de référence sur les capacités de CatDesk.
> À jour au **2026-09-11**. Inventaire basé sur les **68 outils du catalogue**
> enregistrés via
> [registerTools.ts](../packages/agent-runtime/src/tools/registerTools.ts) et leurs
> niveaux de risque dans
> [permissions.ts](../packages/shared-types/src/permissions.ts). Inclut désormais
> le **tableau de bord configurable**, la **news pilotée par l'admin** (Supabase)
> et le **module Bourse** (cf. [docs/projects/](projects/)).
>
> **Profil d'outils** : depuis 2026-07-20 le chat tourne par défaut en profil
> **`research`** — recentré sur les articles/dailys et la recherche générale.
> 25 outils dev/infra ne sont **pas exposés** au chat dans ce profil (liste
> `RESEARCH_EXCLUDED` dans registerTools.ts) : analyse de code
> (`analyze_stacktrace`, `analyze_logs`, `generate_unit_tests`,
> `suggest_refactor`, `analyze_dependencies`), git/CI
> (`generate_commit_message`, `generate_pr_description`, `review_diff`,
> `summarize_git_log`, `resolve_conflicts`, `bisect_guided`, `watch_ci`),
> productivité dev (`detect_spiral`, `generate_standup`, `analyze_code_style`,
> `load_project_context`), infra (`docker_ps`, `docker_control`, `run_sqlite`,
> `query_database`, `audit_env`, `inspect_port`, `kill_process`) et GitHub
> (`github_list_issues`, `github_get_pr`).
> `CATDESK_TOOL_PROFILE=full` réexpose tout le catalogue.
>
> Pour ce que CatDesk **ne sait pas (encore) faire**, voir [LIMITES.md](LIMITES.md).
> Pour les détails techniques : [README](../README.md) ·
> [DISTRIBUTION](DISTRIBUTION.md) ·
> [Concepts avancés](../CATDESK-CONCEPTS-AVANCES.md).

---

## En une phrase

CatDesk est un **copilote IA de bureau 100 % local** (Tauri 2 + React + agent
Node + sidecar Python OCR) : une bulle flottante (`Ctrl+Espace`) qui voit ton
écran, lit tes fichiers, exécute des commandes et automatise des tâches, le tout
via des LLM locaux servis par **Ollama** — aucune donnée n'est envoyée dans le
cloud.

```
React (UI) → Tauri IPC → cœur Rust (sandbox + permissions + audit)
   → agent Node (boucle ReAct + 68 outils) → Ollama (LLM local) + sidecar Python (OCR)
```

---

## Légende des niveaux de risque

| Risque          | Comportement                       |                                             |
| --------------- | ---------------------------------- | ------------------------------------------- |
| 🟢 **Low**      | Exécution automatique, journalisée | lecture, analyse                            |
| 🟡 **Medium**   | Confirmation une fois par session  | écriture, sous-agents                       |
| 🟠 **High**     | Confirmation à chaque appel        | commandes, navigateur actif, réseau sortant |
| 🔴 **Critical** | Désactivé par défaut               | suppression, élévation de privilèges        |

---

## 1. Voir & lire ce qui est devant toi

| Capacité                                                                           | Outil(s)           | Risque |
| ---------------------------------------------------------------------------------- | ------------------ | :----: |
| Lire un fichier                                                                    | `read_file`        |   🟢   |
| Lister un dossier                                                                  | `list_directory`   |   🟢   |
| **Écrire / créer un fichier** (dossiers parents auto, répertoires système bloqués) | `write_file`       |   🟡   |
| Lire le presse-papier                                                              | `read_clipboard`   |   🟢   |
| **Écrire dans le presse-papier** (UTF-8, accents préservés)                        | `write_clipboard`  |   🟡   |
| Capturer l'écran (total/partiel)                                                   | `capture_screen`   |   🟢   |
| Lire le **texte de l'écran (OCR)** Tesseract fra+eng                               | `ocr_region`       |   🟢   |
| **Décrire visuellement** l'écran (modèle multimodal `minicpm-v`)                   | `describe_screen`  |   🟢   |
| **Transcrire un audio → texte** (Whisper local, auto-langue, filtre VAD)           | `transcribe_audio` |   🟢   |
| **Parser un document** PDF / DOCX / CSV → texte + métadonnées                      | `parse_document`   |   🟢   |
| **Analyser un tableau** (CSV/XLSX : agrégats, group-by, stats)                     | `analyze_data`     |   🟢   |
| **Exporter un document** Markdown → PDF / DOCX / HTML                              | `export_document`  |   🟡   |
| Lire un **calendrier** `.ics` (occurrences récurrentes développées)                | `read_calendar`    |   🟢   |

OCR testé en réel : lit le texte de l'écran à ~80 % de confiance (FR+EN).
Les quatre outils « documents » passent par le sidecar Python (`files/`), lancé
à la demande.

### 1 bis. Lui parler, l'entendre répondre (mode « Jarvis », 2026-09-11)

Ce n'est **pas un outil de l'agent** mais une entrée/sortie de l'app, tenue en
Rust (`core/voice/`) et réglée dans **Paramètres › Voix** :

| Capacité                                                                    | Moteur (100 % CPU, `sherpa-onnx`)                | Mesuré (Ryzen 5 5500)         |
| --------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------- |
| **`Ctrl+Espace` ouvre la bulle et le micro** ; fin de phrase au silence     | VAD Silero (0,7 s de silence = fin de tour)      | —                             |
| **Reconnaissance** du français (25 langues détectées, ponctuation comprise) | Parakeet TDT 0.6B v3 int8 (NVIDIA, CC-BY-4.0)    | 5 s d'audio en 0,3 s          |
| **Lecture des réponses à voix haute**, phrase par phrase pendant l'écriture | Piper `fr_FR-miro-high` (voix `siwis` en option) | 1er son 83 ms, 18× temps réel |
| Voix de secours sans modèle                                                 | `speechSynthesis` Windows (Hortense)             | —                             |

- Le micro se ferme **dès la prise de parole obtenue** (un tour), après 8 s
  sans parole, ou quand la bulle se ferme (Échap). Un clic sur le bouton micro
  ou `Ctrl+Espace` pendant que CatDesk parle **le coupe** ; le bouton Stop du
  chat aussi.
- Le Markdown est retiré avant lecture (puces, gras, liens → texte ; un bloc
  de code devient « Bloc de code omis »).
- Option « réécouter après une réponse orale » : enchaîner sans raccourci.
- **Rien ne touche la VRAM** : la RX 6700 reste entière pour `qwen3:14b`.
- Modèles (~800 Mo) : embarqués par l'installeur (`resources/voice/`), ou
  `scripts/fetch-voice-models.ps1` en dev, ou déposés dans
  `%APPDATA%\CatDesk\data\voice`. Absents → micro grisé, voix Windows.
- Pas encore : mot d'activation mains libres (« Hey Jarvis »), coupure de la
  voix en parlant par-dessus (barge-in), réponses volontairement orales du
  modèle — voir [AMELIORATIONS.md](AMELIORATIONS.md) § 4.

## 2. Web & navigateur

| Capacité                                                                                                         | Outil(s)             | Risque |
| ---------------------------------------------------------------------------------------------------------------- | -------------------- | :----: |
| Récupérer une page web (HTTP simple, détecte les SPA)                                                            | `read_webpage`       |   🟢   |
| Naviguer une page JS/SPA (Playwright, Chrome/Edge système)                                                       | `browser_navigate`   |   🟠   |
| Extraire le texte visible d'une page                                                                             | `browser_get_text`   |   🟢   |
| Capture d'écran de la page                                                                                       | `browser_screenshot` |   🟢   |
| Cliquer sur un élément                                                                                           | `browser_click`      |   🟠   |
| Saisir du texte dans un champ                                                                                    | `browser_type`       |   🟠   |
| Fermer le navigateur                                                                                             | `browser_close`      |   🟢   |
| Agréger l'actu tech (HN, The Verge, TechCrunch, DEV.to…)                                                         | `fetch_tech_news`    |   🟢   |
| **Chercher/lire les dailys** (revues de presse locales + partagées) pour répondre aux questions sur les articles | `search_dailies`     |   🟢   |

`read_webpage` détecte une SPA (HTML lourd, texte quasi nul) et oriente
automatiquement l'agent vers `browser_navigate` + `browser_get_text`.

## 3. Connecteurs externes

| Capacité                                                  | Outil(s)                 | Risque |
| --------------------------------------------------------- | ------------------------ | :----: |
| Chercher/lire des notes dans un vault **Obsidian** local  | `obsidian_notes`         |   🟢   |
| Chercher/lire des pages **Notion** (API)                  | `notion_search`          |   🟢   |
| Appeler une **API REST** (GET auto ; écriture confirmée)  | `call_api`               |   🟠   |
| Poster sur un **webhook Discord/Slack**                   | `send_webhook_message`   |   🟠   |
| Publier l'actu tech sur un webhook Discord (embeds)¹      | `post_tech_news_discord` |   🟡   |
| Lire une **boîte mail IMAP** (recherche, en-têtes, corps) | `read_email`             |   🟠   |

¹ URL limitée aux webhooks Discord (`discord.com/api/webhooks/…`). `obsidian_notes`
ne lit un vault que s'il est dans la liste blanche des chemins.

## 4. Développement & analyse de code

| Capacité                                                                    | Outil(s)               | Risque |
| --------------------------------------------------------------------------- | ---------------------- | :----: |
| Analyser une **stacktrace** (Node/TS/Python/Rust/Java + cause racine)       | `analyze_stacktrace`   |   🟢   |
| Analyser un **fichier de log** local (erreurs, patterns, lecture seule)     | `analyze_logs`         |   🟢   |
| Générer des **tests unitaires** (détecte le framework)                      | `generate_unit_tests`  |   🟢   |
| Repérer des **refactos** (fonctions longues, duplication, complexité)       | `suggest_refactor`     |   🟢   |
| Analyser les **dépendances** (package.json / Cargo.toml / requirements.txt) | `analyze_dependencies` |   🟢   |
| **Relire un diff** (secrets, code de debug, patterns risqués)               | `review_diff`          |   🟢   |
| Inférer les **conventions de style** du projet                              | `analyze_code_style`   |   🟢   |
| **Profiler un projet** à l'ouverture (stack, scripts, structure, README)    | `load_project_context` |   🟢   |
| Auditer un `.env` vs `.env.example` (clés manquantes, secrets)              | `audit_env`            |   🟢   |
| Recherche locale par mots-clés/sémantique                                   | `semantic_search`      |   🟢   |

## 5. Git & GitHub

| Capacité                                                        | Outil(s)                  | Risque |
| --------------------------------------------------------------- | ------------------------- | :----: |
| Générer un **message de commit** (Conventional Commits)         | `generate_commit_message` |   🟢   |
| Générer une **description de PR** (commits vs base)             | `generate_pr_description` |   🟢   |
| Résumer l'**historique git** (par type/auteur/zone)             | `summarize_git_log`       |   🟢   |
| Aider à résoudre les **conflits de merge** (ours/theirs)        | `resolve_conflicts`       |   🟢   |
| Piloter un **git bisect** (compter, choisir le prochain commit) | `bisect_guided`           |   🟢   |
| Surveiller la **CI GitHub Actions** (jobs/étapes en échec)      | `watch_ci`                |   🟢   |
| Lister/chercher des **issues GitHub**                           | `github_list_issues`      |   🟢   |
| Détails complets d'une **PR** (fichiers, reviews, diff)         | `github_get_pr`           |   🟢   |

## 6. Productivité

| Capacité                                               | Outil(s)           | Risque |
| ------------------------------------------------------ | ------------------ | :----: |
| Détecter quand tu **tournes en rond** sur un problème  | `detect_spiral`    |   🟢   |
| Rédiger un **standup quotidien** depuis l'activité git | `generate_standup` |   🟢   |

## 7. Système & infra (local)

| Capacité                                                       | Outil(s)         | Risque |
| -------------------------------------------------------------- | ---------------- | :----: |
| Exécuter une **commande** PowerShell/CMD (sandbox)             | `run_command`    |   🟠   |
| **Ouvrir une application** (nom, chemin ou app du PATH)        | `open_app`       |   🟠   |
| Lister les **ports TCP** en écoute + processus liés            | `inspect_port`   |   🟢   |
| **Tuer un processus** par PID                                  | `kill_process`   |   🟠   |
| Lister les **conteneurs Docker** + logs                        | `docker_ps`      |   🟢   |
| Contrôler Docker (start/stop/restart, compose up/down)         | `docker_control` |   🟠   |
| Requêter une base **SQLite** locale (lecture seule par défaut) | `run_sqlite`     |   🟡   |
| Requêter **PostgreSQL / MySQL** (SELECT, lecture seule)        | `query_database` |   🟠   |

`run_sqlite` refuse les dot-commands du CLI (`.shell`, `.output`…), qui
permettaient d'exécuter une commande système.

## 8. Mémoire & RAG

| Capacité                                                          | Outil(s)        | Risque |
| ----------------------------------------------------------------- | --------------- | :----: |
| Rechercher en **mémoire** (sémantique ou repli mots-clés)         | `search_memory` |   🟢   |
| **Stocker un fait en mémoire** persistante (tags, inter-sessions) | `store_memory`  |   🟡   |

- VectorStore réel : embeddings Ollama (`nomic-embed-text`) + similarité cosinus
  en mémoire, persistance disque (`vectors.json`, écriture atomique). Les
  échanges indexés automatiquement sont plafonnés aux 2 000 plus récents ; les
  faits stockés explicitement ne sont jamais évincés.
- **Repli automatique mots-clés** si les embeddings sont indisponibles → la
  mémoire fonctionne dès l'installation. Après un échec, les embeddings sont
  suspendus une minute puis réessayés (ils restaient coupés jusqu'au redémarrage).
- **Contexte de conversation** : les messages les **plus récents** de la
  conversation (ils étaient pris depuis le début), plus le résumé glissant des
  messages plus anciens et les faits durables de la mémoire tiède. Les tâches de
  fond (consolidation 6 h, évolution 24 h) font désormais leur première passe
  peu après le démarrage — elles n'atteignaient jamais leur premier tick.

## 9. Orchestration & autonomie

| Capacité                                                                | Outil(s)                | Risque |
| ----------------------------------------------------------------------- | ----------------------- | :----: |
| Lancer un **sous-agent** isolé (contexte propre, anti-récursion)        | `run_subagent`          |   🟡   |
| Lancer jusqu'à 8 **sous-agents en parallèle**                           | `run_parallel_agents`   |   🟡   |
| **Planifier une tâche récurrente** (cron, tick 60s, persistance SQLite) | `schedule_task`         |   🟠   |
| Lister les tâches planifiées                                            | `list_scheduled_tasks`  |   🟢   |
| Annuler une tâche planifiée                                             | `cancel_scheduled_task` |   🟡   |

Formats cron supportés : `"every 5m"`, `"hourly"`, `"daily"`, `"weekly"`.

**Planification opt-in** : pour les tâches multi-étapes, l'agent peut d'abord
établir un plan (visible dans l'UI sous un encart « 📋 Plan ») puis le suivre
(`usePlanning: true`).

---

## 10. Tableau de bord & Bourse

Interface d'accueil = **canvas libre de widgets configurables** (KPI, stats, actions,
bourse, news) — voir [dashboard.md](projects/dashboard.md).

| Capacité                                           | Outil(s)                | Risque |
| -------------------------------------------------- | ----------------------- | :----: |
| Lire l'instantané bourse (cotations + formules)    | `get_market`            |   🟢   |
| Ajouter un symbole à la watchlist live             | `add_to_watchlist`      |   🟡   |
| Retirer un symbole de la watchlist                 | `remove_from_watchlist` |   🟡   |
| Créer/modifier une formule (mathjs, recalcul live) | `set_formula`           |   🟡   |
| Supprimer une formule                              | `remove_formula`        |   🟡   |

- **Bourse live** : cotations Yahoo rafraîchies ~30 s, **formules** (ratios…)
  recalculées à chaque tick, **sparklines** par symbole. **Formules glissantes** :
  `X.history`, `sma(X.history, n)`, `ema(X.history, n)` (B1). **Historique
  persisté en SQLite** (`data/market.db`, B6) — survit aux redémarrages.
  Les symboles et formules
  des widgets pilotent la watchlist du sidecar (synchro automatique).
- **News** : annonce rédigée par l'**admin seul** (Supabase + RLS), diffusée à
  tous les clients en lecture seule (bandeau + widget). Setup :
  [dashboard.md](projects/dashboard.md) §5.

## 11. Modèles & inférence

- **Modèle de chat UNIQUE (v0.1.3) : `qwen3:14b`** — le plus fort qui tient sur
  ~10 Go de VRAM. `get_recommended_model` le renvoie toujours (plus de choix
  selon la VRAM). Plus `minicpm-v` (vision, chargé à la demande) et
  `nomic-embed-text` (mémoire sémantique). Les noms par défaut et l'URL Ollama
  vivent dans `@catdesk/shared-types` (`models.ts`), recopiés côté Rust sous
  test miroir.
- **Réglages › Modèle** (modèle, température, itérations max) sont réellement
  appliqués à chaque message — ils étaient enregistrés mais jamais envoyés.
  « Automatique » suit la recommandation.
- **Plus de palier `qwen2.5:7b`** : retiré du bundle et de l'UI. Il forçait un
  swap VRAM 14b↔7b (10-20 s) et ratait les questions d'actu ; les machines
  cibles ont ≥ ~10 Go de VRAM. `CATDESK_MODEL_SMALL` reste un opt-in env pour
  imposer un petit modèle sur une machine très contrainte.
- **`qwen2.5-coder:14b` retiré** du bundle et de l'UI (bot sans codage).
- Efficience : `keep_alive` (modèle gardé chaud, défaut 10 min), `num_ctx`
  réglable par requête.
- ⚠️ **KV-cache `q4_0` : contradiction non tranchée.** Cette doc a longtemps
  affirmé que `q4_0` corrompt la sortie sur la RX 6700 (Vulkan — texte
  illisible, incident 2026-06-15/16), mais `commands/tuning.rs` l'active quand
  la VRAM est serrée, mesures à l'appui, scopé au process Ollama de CatDesk et
  toujours avec `OLLAMA_FLASH_ATTENTION=1`. Sur la machine cible, le tuner
  renvoie donc `q4_0`. Le test qui tranche est décrit dans
  [AMELIORATIONS.md](AMELIORATIONS.md) §1.1.
- Matériel cible réel : **AMD RX 6700, 10 Go VRAM** → éviter les modèles 20B+
  qui débordent en RAM (voir [LIMITES.md](LIMITES.md) §3).

## 12. Garde-fous & sécurité

- **Local-first** : l'**inférence** reste 100 % locale (Ollama, aucune sortie
  réseau). Les seuls flux distants sont **en lecture seule et allow-listés** :
  cotations bourse et news (Supabase). Voir [LIMITES.md](LIMITES.md).
- **Contrôle des chemins côté agent** : chaque outil déclare ses arguments-chemins
  (`BaseTool.pathArgs`) et `PermissionEngine` les vérifie tous contre la liste
  blanche, quel que soit le niveau de risque. Le sandbox Rust (`check_path` /
  `check_command`) reste le garde obligatoire de toute future commande Tauri
  touchant au disque ou au shell — voir [SECURITE.md](SECURITE.md).
- **Permissions risk-gated** à 4 niveaux (auto / une fois / confirmer / désactivé).
  Sans réponse en 60 s, la demande vaut refus : l'agent continue sans l'outil.
- **Safe mode** : un toggle bloque tous les outils medium+ (rejoué à l'agent à
  chaque (re)démarrage).
- **Audit** : chaque appel d'outil journalisé (horodatage, args **expurgés** —
  mots de passe, tokens, webhooks masqués —, résultat) et chaque
  ouverture/fermeture du micro (`VOICE_LISTEN_START/STOP`).
- **Isolation de processus** : agent et sidecar OCR tournent séparément. L'agent
  est supervisé par Rust (relancé après un crash, jusqu'à 5 fois avec délai
  croissant) et arrêté proprement avec l'app, comme l'Ollama qu'elle a lancé.

## 13. Distribution

- **Installeur Windows hors-ligne** (Inno Setup, ~18 Go avec modèles, v0.1.3 ;
  +~0,8 Go de modèles voix depuis 2026-09, `-SkipVoice` pour s'en passer) :
  install/désinstall silencieux vérifiés de bout en bout.
- Le **modèle** (lourd, immuable) est séparé du code → les **mises à jour
  auto** (GitHub Releases, signées) ne transportent que le code (~50–300 Mo).
- Détails complets : [DISTRIBUTION.md](DISTRIBUTION.md).

---

_Cette carte évolue avec le projet. Pour les bornes actuelles, voir
[LIMITES.md](LIMITES.md)._
