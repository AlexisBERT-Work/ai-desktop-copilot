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

## Prochaines pistes (par valeur)
1. ⬜ Étendre les tests aux autres outils purs (git, github, web parsing).
2. ⬜ Boucle d'agent plan→exécute pour les recherches multi-étapes.
3. ⬜ Implémenter la capture écran côté Rust (`screen.rs` stub) OU assumer que
   tout passe par le sidecar Python.
4. ⬜ Packaging / distribution.

_Aucun commit effectué — tout est dans l'arbre de travail._
