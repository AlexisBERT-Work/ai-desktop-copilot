# Changelog

All notable changes to CatDesk will be documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
Versioning: [Semantic Versioning](https://semver.org/)

---

## [Unreleased]

### Added — 2026-06 → 2026-07
- **63 outils agent** enregistrés (perception, code/git, connecteurs, système,
  navigateur, bourse, automatisation) — voir `docs/CAPACITES.md`
- **Plateforme dashboard** : grille de widgets configurables (ajout, drag-reorder,
  resize, config, persistance), fenêtre dédiée, guide imprimable PDF
- **Module Bourse** : cotations Yahoo (~30 s), formules mathjs, sparklines,
  synchro watchlist ↔ sidecar, 5 outils agent
- **News & Dailys (Supabase)** : bandeau news, flux éditorial admin (RLS),
  console admin in-app, filtrage par centre d'intérêt, pagination serveur
- **Revue de presse automatique** : digest quotidien par sujet et par journal
  (LLM local), journaux personnalisés admin (sources/URLs + regex), publication
  cron, miroir Discord
- **Mémoire hiérarchique** : VectorStore hybride (embeddings + BM25),
  WarmMemoryStore + FactExtractor + MemoryConsolidator, cache sémantique
- **Auto-évolution** : PlaybookStore + EvolutionDaemon (propositions, humain
  dans la boucle), SpiralMonitor proactif
- **Sécurité** : sanitizeToolOutput (redaction secrets + spotlighting
  anti-injection sur les sorties d'outils)
- **Boucle plan→exécute** opt-in (Planner) avec plan affiché dans le chat ;
  routeur de modèles Auto / Léger / Code
- Socle de tests vitest : **436 tests (61 fichiers)**

### Added — scaffold initial (2026-05)
- Initial project structure and monorepo setup
- Shared TypeScript types package (`@catdesk/shared-types`)
- Agent runtime scaffold with Ollama client and streaming
- Permission engine with risk-level gating
- Conversation store (SQLite)
- Vector store stub (LanceDB in Phase 2)
- Audit logger
- OCR/Vision Python sidecar scaffold
- PDF, DOCX, CSV file parsers
- CI/CD GitHub Actions workflows
- Full project documentation and README

### Architecture
- Tauri 2.x + React 19 + Rust + Node.js + Python stack
- Hexagonal/modular architecture
- JSON-RPC 2.0 IPC protocol
- ReAct agent loop with tool system
