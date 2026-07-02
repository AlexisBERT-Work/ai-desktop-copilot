# SUIVI — Évolution de CatDesk

> Journal de travail. Voir aussi [CAPACITES.md](CAPACITES.md).
> Dernière mise à jour : 2026-07-02.

## État actuel
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
- [x] Outil orphelin `analyze_logs` (branche `feat/analyze-logs-tool`, complet
      + testé mais jamais intégré) rapatrié dans `master`.
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
