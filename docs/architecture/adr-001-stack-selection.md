# ADR-001 — Technology Stack Selection

**Date:** 2026-05-27
**Status:** Accepted
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
