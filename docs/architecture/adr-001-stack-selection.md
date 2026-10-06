# ADR-001 — Technology Stack Selection

**Date:** 2026-05-27
**Status:** Accepted — _partiellement superseded, voir la note en fin de document_
**Deciders:** @alexis.bert1412

---

## Context

We need to choose the desktop framework, UI layer, LLM backend, and storage solution for a local AI desktop copilot running on Windows.

## Decision

**Desktop Framework: Tauri 2.x** over Electron

- Tauri produces ~8MB bundles vs ~150MB for Electron
- Uses the OS WebView2 (pre-installed on Windows 11) — no bundled Chromium
- Rust core provides memory safety and native API access
- Capability-based security model is a first-class feature
- IPC is type-safe with generated Rust/TS bindings

**Agent Runtime: Node.js sidecar** over Python or Rust

- Rich npm ecosystem for AI tooling and LLM clients
- TypeScript end-to-end type safety
- Faster iteration for tool development
- Python used only for OCR/vision/ML where native libraries are required

**LLM: Ollama** over llama.cpp direct or other

- Best UX for local model management (pull, list, serve)
- REST + SSE streaming API
- Supports all target models (Qwen, Llama, DeepSeek, Mistral)
- Optional future: can proxy to OpenAI/Anthropic with same interface shape

**Storage: SQLite (conversations) + LanceDB (vectors)**

- SQLite: zero-configuration, battle-tested, FTS5 built-in
- LanceDB: embedded vector DB, no server process, Rust-native, Arrow format

## Consequences

- Windows 11 is primary target (WebView2 guaranteed)
- Rust knowledge required for core backend work
- Python required for OCR/vision extensions
- Three runtimes (Rust, Node, Python) increase setup complexity
  → Mitigated by `scripts/setup.ps1` automation

---

## Note de supersession — 2026-08-31

Un ADR ne se réécrit pas ; voici ce que la réalité a démenti depuis.

**Le stockage vectoriel n'utilise pas LanceDB.** Il n'a jamais été intégré. Le
`VectorStore` est une implémentation maison (cosinus + BM25, persistée en JSON)
qui prend ses embeddings d'Ollama (`nomic-embed-text`) — motivation : zéro
dépendance native à compiler sur les trois plateformes. Le choix est assez
structurant pour que `SettingsWindow.test.tsx` porte un test de non-régression
explicite contre une réintroduction de LanceDB. SQLite (via sql.js) reste bien
en place pour les conversations, l'historique bourse, le playbook et la mémoire
warm.

**« Supports all target models (Qwen, Llama, DeepSeek, Mistral) » est caduc.**
Depuis la v0.1.3, CatDesk embarque **un seul modèle de chat**, `qwen3:14b` — le
duo 14B/7B ne tenait pas dans 10 Go de VRAM et chaque rétrogradation forçait un
swap plus coûteux que le gain. Ollama reste polyvalent, mais le produit ne l'est
plus : voir `CLAUDE.md` et `docs/CAPACITES.md` §11.

**Le reste tient.** Tauri 2, le sidecar Node, Python cantonné à l'OCR/vision et
au parsing de documents : ces trois décisions n'ont pas été remises en cause.
