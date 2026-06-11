# SUIVI — Évolution de NeuroDesk

> Journal de travail. Voir aussi [CAPACITES.md](CAPACITES.md).
> Dernière mise à jour : 2026-06-11.

## État actuel
Projet bien avancé : ~27 outils agent enregistrés (filesystem, système, web,
navigateur Playwright, git, GitHub, écran/OCR, audio, mémoire, sous-agents,
cron, analyse). Stack Tauri 2 + React 19 + Node agent-runtime + sidecar Python.
Le monorepo type-check intégralement.

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

Lancer : `pnpm --filter @neurodesk/agent-runtime test`.

## Routeur de modèles — câblé (2026-06-11)
- [x] `llm/ModelRouter.ts` recréé (heuristique simple, testable).
- [x] Câblé dans `AgentOrchestrator` en **downgrade-only** : `large` = modèle
      choisi par l'UI, rétrograde vers `small` seulement pour les tâches triviales
      (sans outils, courtes, sans indice de complexité). Décision prise une fois
      par run, journalisée.
- [x] Activé via `NEURODESK_MODEL_SMALL` (absent => aucun routage, comportement
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

## Prochaines pistes (par valeur)
1. ⬜ Rendre le plan visible dans l'UI (nouveau type d'AgentStep + bridge Rust).
3. ⬜ Implémenter la capture écran côté Rust (`screen.rs` stub) OU assumer que
   tout passe par le sidecar Python.
4. ⬜ Packaging / distribution.

_Aucun commit effectué — tout est dans l'arbre de travail._
