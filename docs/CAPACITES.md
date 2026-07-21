# CE QUE CATDESK SAIT FAIRE

> Document unique de référence sur les capacités de CatDesk.
> À jour au **2026-07-20**. Inventaire basé sur les **68 outils du catalogue**
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
| **Décrire visuellement** l'écran (modèle multimodal `llava:7b`)                    | `describe_screen`  |   🟢   |
| **Transcrire un audio → texte** (Whisper local, auto-langue, filtre VAD)           | `transcribe_audio` |   🟢   |

OCR testé en réel : lit le texte de l'écran à ~80 % de confiance (FR+EN).

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

| Capacité                                                 | Outil(s)                 | Risque |
| -------------------------------------------------------- | ------------------------ | :----: |
| Chercher/lire des notes dans un vault **Obsidian** local | `obsidian_notes`         |   🟢   |
| Chercher/lire des pages **Notion** (API)                 | `notion_search`          |   🟢   |
| Appeler une **API REST** (GET auto ; écriture confirmée) | `call_api`               |   🟠   |
| Poster sur un **webhook Discord/Slack**                  | `send_webhook_message`   |   🟠   |
| Publier l'actu tech sur un webhook Discord (embeds)      | `post_tech_news_discord` |   🟡   |

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
| **Ouvrir une application** (nom, chemin ou app du PATH)        | `open_app`       |   🟡   |
| Lister les **ports TCP** en écoute + processus liés            | `inspect_port`   |   🟢   |
| **Tuer un processus** par PID                                  | `kill_process`   |   🟠   |
| Lister les **conteneurs Docker** + logs                        | `docker_ps`      |   🟢   |
| Contrôler Docker (start/stop/restart, compose up/down)         | `docker_control` |   🟠   |
| Requêter une base **SQLite** locale (lecture seule par défaut) | `run_sqlite`     |   🟡   |

## 8. Mémoire & RAG

| Capacité                                                          | Outil(s)        | Risque |
| ----------------------------------------------------------------- | --------------- | :----: |
| Rechercher en **mémoire** (sémantique ou repli mots-clés)         | `search_memory` |   🟢   |
| **Stocker un fait en mémoire** persistante (tags, inter-sessions) | `store_memory`  |   🟡   |

- VectorStore réel : embeddings Ollama (`nomic-embed-text`) + similarité cosinus
  en mémoire, persistance disque (`vectors.json`).
- **Repli automatique mots-clés** si les embeddings sont indisponibles → la
  mémoire fonctionne dès l'installation.

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

Interface d'accueil = **grille de widgets configurables** (KPI, stats, actions,
bourse, news) — voir [dashboard-platform.md](projects/dashboard-platform.md).

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
  [dashboard-p2.md](projects/dashboard-p2.md).

## 11. Modèles & inférence

- **Tri 2026-07-20 — UN seul modèle de chat par machine** (choix VRAM du
  launcher) : `qwen3:14b` si ≥ 9 GiB, sinon `qwen2.5:7b`. Plus `minicpm-v`
  (vision, hors bundle) et `nomic-embed-text` (mémoire sémantique).
- **Plus de sélecteur de mode ni de rétrogradation auto** : le palier léger
  forçait un swap VRAM 14b↔7b (10-20 s) plus coûteux que la réponse elle-même,
  et le 7b ratait les questions d'actu (outil annoncé en texte). Le mode
  `CATDESK_MODEL_SMALL` reste un opt-in env pour expérimenter.
- **`qwen2.5-coder:14b` retiré** du bundle et de l'UI (bot sans codage).
- Efficience : `keep_alive` (modèle gardé chaud, défaut 10 min), `num_ctx`
  réglable par requête. ⚠️ **Pas de KV-cache 4-bit global** : `q4_0` corrompt la
  sortie de `qwen2.5:7b` sur la RX 6700 (Vulkan) — texte illisible (incident
  2026-06-15/16).
- Matériel cible réel : **AMD RX 6700, 10 Go VRAM** → éviter les modèles 20B+
  qui débordent en RAM (voir [LIMITES.md](LIMITES.md) §3).

## 12. Garde-fous & sécurité

- **Local-first** : l'**inférence** reste 100 % locale (Ollama, aucune sortie
  réseau). Les seuls flux distants sont **en lecture seule et allow-listés** :
  cotations bourse et news (Supabase). Voir [LIMITES.md](LIMITES.md).
- **Sandbox Rust** : `check_path` + `check_command` avant tout accès FS/shell.
- **Permissions risk-gated** à 4 niveaux (auto / une fois / confirmer / désactivé).
- **Safe mode** : un toggle bloque tous les outils medium+.
- **Audit** : chaque appel d'outil journalisé (horodatage, args, résultat).
- **Isolation de processus** : agent et sidecar OCR tournent séparément.

## 13. Distribution

- **Installeur Windows hors-ligne** (Inno Setup, ~19 Go avec modèles) :
  install/désinstall silencieux vérifiés de bout en bout.
- Le **modèle** (lourd, immuable) est séparé du code → les **mises à jour
  auto** (GitHub Releases, signées) ne transportent que le code (~50–300 Mo).
- Détails complets : [DISTRIBUTION.md](DISTRIBUTION.md).

---

_Cette carte évolue avec le projet. Pour les bornes actuelles, voir
[LIMITES.md](LIMITES.md)._
