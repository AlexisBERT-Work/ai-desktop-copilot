# CAPACITÉS — Tout ce que NeuroDesk sait (ou saura) faire

> Carte de vision, à jour au 2026-06-11. ✅ fonctionne · 🟡 câblé/partiel · ⬜ prévu.
> Inventaire basé sur les outils réellement enregistrés dans
> `packages/agent-runtime/src/index.ts`.

## 1. Lire ce qui est devant toi
- ✅ **Fichiers** : `read_file`, `list_directory`
- ✅ **Presse-papier** : `read_clipboard`
- ✅ **Pages web** : `read_webpage`
- 🟡 **Écran (OCR)** : `capture_screen`, `ocr_region` *(câblés ; requièrent l'env
  Python + Tesseract)*
- 🟡 **Audio → texte** : `transcribe_audio`

## 2. Chercher & analyser
- 🟡 **Mémoire sémantique** : `search_memory`, `store_memory`, `semantic_search`
  *(VectorStore réel depuis cette session ; sémantique complète dès
  `ollama pull nomic-embed-text`, sinon repli mots-clés)*
- ✅ **Analyse de stacktrace** : `analyze_stacktrace`

## 3. Agir sur le PC
- ✅ **Commandes système** : `run_command` (sandbox + confirmation)
- ✅ **Navigateur automatisé (Playwright)** : `browser_navigate`,
  `browser_screenshot`, `browser_get_text`, `browser_click`, `browser_type`,
  `browser_close`

## 4. Git & GitHub
- ✅ **Git** : `git_commit`, `git_pr`, `watch_ci`
- ✅ **GitHub** : `github_issues`, `github_pr`

## 5. Orchestration & autonomie
- ✅ **Planification (opt-in)** : pour les tâches multi-étapes, l'agent établit
  d'abord un plan puis le suit. Activer avec `usePlanning: true` dans la config.
- ✅ **Sous-agents** : `run_subagent`, `run_parallel_agents`
- ✅ **Tâches planifiées (cron)** : `schedule_task`, `list_scheduled_tasks`,
  `cancel_scheduled_task`

## 6. Garde-fous
- ✅ Sandbox Rust, permissions risk-gated, audit, 100 % local (Ollama).

## 7. Efficience ressources
- ✅ **`keep_alive`** Ollama (modèle gardé chaud, défaut 10 min, `OLLAMA_KEEP_ALIVE`)
- ✅ **`num_ctx`** réglable par requête
- ✅ **Swap de modèles (Auto / Léger / Code)** : sélecteur dans le chat.
  *Auto* route (léger pour le trivial, code/heavy sinon), *Léger* économise,
  *Code* force le gros modèle de code (`qwen2.5-coder:14b`). Aussi pilotable
  par env `NEURODESK_MODEL_SMALL`.

## 8. Ce qui reste à durcir
- ⬜ Capture écran côté Rust (`screen.rs` est un stub)
- ⬜ Couverture de tests automatisés
- ⬜ Boucle d'agent plan→exécute pour recherches longues
- ⬜ Packaging / signature / mises à jour
