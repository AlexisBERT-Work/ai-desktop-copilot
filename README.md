# CatDesk — AI Desktop Copilot

<div align="center">

**Local-first AI desktop copilot. Powerful. Private. Extensible.**

[![License: MIT](https://img.shields.io/badge/License-MIT-purple.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue.svg)](https://www.typescriptlang.org/)
[![Rust](https://img.shields.io/badge/Rust-1.96-orange.svg)](https://www.rust-lang.org/)
[![Tauri](https://img.shields.io/badge/Tauri-2.x-24C8D8.svg)](https://tauri.app/)
[![Ollama](https://img.shields.io/badge/Ollama-local%20LLM-black.svg)](https://ollama.com/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

[Features](#features) · [Architecture](#architecture) · [Quick Start](#quick-start) · [Roadmap](#roadmap) · [Contributing](#contributing)

Current version **0.1.3** · Windows only · the docs under `docs/` are written in French

</div>

---

## What is CatDesk?

CatDesk is a **local AI desktop copilot**: a floating assistant that can read your
screen, analyse your files, run tools and brief you on the news — driven by a local
LLM through [Ollama](https://ollama.com/). No subscription, and no prompt or document
is ever sent to a model provider.

> **"Powerful locally, private by design, extensible by nature"**

Local-first is not the same as offline. Inference, memory and files stay on your
machine, but a few features deliberately reach the network — see [Security](#security).

---

## Features

### Chat assistant

- Floating always-on-top overlay, global hotkey (`Ctrl+Space`, with `Ctrl+Shift+Space` as a fallback)
- Token-by-token streaming, Markdown and syntax-highlighted code
- Conversation history in SQLite, rolling summarisation on long sessions

### Local LLM

- **One chat model, `qwen3:14b`** — the strongest that fits the ~10 GB VRAM target.
  `minicpm-v` is loaded on demand for vision, `nomic-embed-text` for embeddings.
- KV-cache auto-tuning from detected VRAM
- Passive mode unloads the model after an idle window, giving the GPU back

### Press review and dailies

- Daily digest per topic and per newspaper, written by the local LLM
- Custom local journals (your own sources, include/exclude regexes)
- Shared dailies published to Supabase from any machine running CatDesk
- Optional Discord mirror

### Dashboard and markets

- Free-placement widget canvas: KPI, chart, table, news, dailies, quick actions, stocks
- Live Yahoo quotes with user-defined mathjs formulas and sparklines
- Dedicated window, printable widget guide

### Screen and documents

- Full or region screen capture, local OCR (Tesseract), screen description via the vision model
- PDF, DOCX, CSV and ICS parsing, data analysis, document export
- Local audio transcription (faster-whisper)

### Memory and RAG

- Hybrid vector store (Ollama embeddings + BM25), persisted as JSON
- Warm memory: structured facts about you, mined in the background
- Semantic cache: answers an equivalent question without calling the LLM

### Security first

- 68 tools, each with a risk level: auto, once per session, or confirm every time
- Command blocklist and path confinement enforced in Rust
- Every tool call and every side-effectful command is audited
- Safe mode: one toggle blocks every medium-or-above tool
- Agent, OCR and Ollama run as separate processes

---

## Architecture

```
React 19 (webview)
    │  Tauri invoke + events   (typed; the contract is mirrored in Rust)
Rust core (Tauri 2)
    │  JSON-RPC 2.0 over stdin/stdout
Node.js agent runtime (sidecar)          ──→ Ollama (HTTP, local)
    │  JSON-RPC 2.0 over stdin/stdout
Python OCR/vision sidecar (spawned on demand)
```

Three rules hold this together:

1. **The UI never talks to a sidecar.** Every `invoke()` lives in
   `apps/desktop/src/shared/api/`, enforced by an ESLint `no-restricted-imports` rule
   rather than by convention.
2. **The IPC contract has one source of truth.**
   `packages/shared-types/src/ipc-contract.ts` defines the event and method names, and a
   `cargo test` compares the Rust mirror against that very file with `include_str!` — so
   drift breaks the build on both sides.
3. **Every tool declares a zod schema**, which is the single source for both runtime
   validation and the JSON Schema handed to the model.

### Agent loop (ReAct)

```
input → context (history + memory + facts) → LLM
          │                                   │
   semantic cache                    text ────┴──── tool call
          │                            │              │
   direct answer                    stream      permission gate
                                                      │
                                              sandboxed execution
                                                      │
                                               result → LLM (loop)
```

### Permission model

| Risk level      | Behaviour              | Examples                                        |
| --------------- | ---------------------- | ----------------------------------------------- |
| 🟢 **Low**      | Auto-execute, logged   | `read_file`, `capture_screen`, `ocr_region`     |
| 🟡 **Medium**   | Ask once per session   | `write_file`, `write_clipboard`, `store_memory` |
| 🟠 **High**     | Confirm every time     | `run_command`, `open_app`, `read_email`         |
| 🔴 **Critical** | Reserved, none shipped | —                                               |

No tool currently ships at `critical`. The level exists so that a future destructive
tool is disabled by default rather than retrofitted into the model.

---

## Tech stack

| Layer         | Technology                      | Why                                     |
| ------------- | ------------------------------- | --------------------------------------- |
| Desktop shell | **Tauri 2.x**                   | Small bundle, capability security model |
| Frontend      | **React 19 + TypeScript**       | Concurrent rendering, streaming UI      |
| Styling       | **Tailwind CSS 4**              | Utility-first, tree-shaken              |
| State         | **Zustand**                     | Lightweight, no provider tree           |
| Animation     | **Framer Motion**               | Overlay transitions                     |
| Core runtime  | **Rust**                        | Memory safety, native syscalls          |
| Agent runtime | **Node.js (sidecar)**           | npm AI ecosystem, fast tool iteration   |
| LLM           | **Ollama**                      | Best local runner, model management     |
| OCR / vision  | **Tesseract + mss (Python)**    | Mature, multilingual, local             |
| Vector store  | **In-house (cosine + BM25)**    | Ollama embeddings, no native dependency |
| File parsing  | **Python (pypdf, python-docx)** | Mature document libraries               |
| Backend       | **Supabase**                    | Shared dailies and news, RLS-gated      |
| Monorepo      | **pnpm + Turborepo**            | Fast builds, workspace linking          |

---

## Project structure

```
ai-desktop-copilot/
├── apps/desktop/
│   ├── src-tauri/src/
│   │   ├── commands/     # IPC handlers: chat, press, models, tuning, settings, permissions
│   │   ├── core/         # sandbox, audit, error, ollama, hotkeys, tray, updater, resources
│   │   └── ipc/          # protocol constants (+ contract test), Node sidecar bridge
│   └── src/
│       ├── features/     # chat · overlay · agent · dashboard · market · news · dailies
│       │                 # · proactive · settings
│       ├── shared/       # api/ (the only invoke() call sites), hooks, ui tokens
│       └── styles/
│
├── packages/
│   ├── agent-runtime/src/
│   │   ├── tools/        # the 68 tools, one folder per category
│   │   ├── news/         # press-review domain: sources, parsing, aggregation, digests
│   │   ├── llm/          # Ollama client, completion, planner, model router
│   │   ├── memory/       # conversations, vectors, warm facts, semantic cache
│   │   └── market/ playbook/ permissions/ security/ ipc/ lib/
│   ├── ocr-vision/       # Python sidecar: ocr/ vision/ audio/ files/
│   └── shared-types/     # TypeScript types shared by all three layers
│
├── supabase/             # migrations and RLS for shared news and dailies
├── scripts/              # setup, dev, release build, Inno installer, update publishing
└── docs/                 # see the document map in CLAUDE.md
```

---

## Quick Start

### Prerequisites

| Tool     | Version | Install                          |
| -------- | ------- | -------------------------------- |
| Node.js  | ≥ 22    | [nodejs.org](https://nodejs.org) |
| pnpm     | ≥ 11.3  | `npm i -g pnpm`                  |
| Rust     | ≥ 1.96  | [rustup.rs](https://rustup.rs)   |
| Python   | ≥ 3.12  | [python.org](https://python.org) |
| Ollama   | latest  | [ollama.com](https://ollama.com) |
| WebView2 | latest  | Pre-installed on Windows 11      |

These are the versions CI builds with. Node 22 is a hard floor: pnpm 11.3 requires it.

### 1. Clone and set up

```powershell
git clone https://github.com/AlexisBERT-Work/ai-desktop-copilot.git
cd ai-desktop-copilot
.\scripts\setup.ps1
```

### 2. Pull the models

`setup.ps1` offers to do this for you:

```powershell
ollama pull qwen3:14b         # chat — the only chat model
ollama pull minicpm-v         # vision ("describe my screen")
ollama pull nomic-embed-text  # embeddings for RAG
```

### 3. Start

```powershell
pnpm dev
```

This starts the Tauri dev window (hot reload) and the Node agent sidecar. Ollama must
already be running. The Python OCR sidecar is spawned on demand by the agent, the first
time a vision or document tool is used.

### 4. Open CatDesk

Press `Ctrl+Space` anywhere.

---

## Agent tools

**68 tools** are registered, covering perception, web, connectors, code and git, system,
browser, markets and automation. The catalogue — names, arguments and risk levels — is
maintained in **[docs/CAPACITES.md](docs/CAPACITES.md)** (single source of truth, in
French); current limits are in [docs/LIMITES.md](docs/LIMITES.md).

The agent runs in the `research` profile by default: 25 developer and infra tools are
not exposed to the chat, leaving 43. Set `CATDESK_TOOL_PROFILE=full` to expose all 68.

---

## Roadmap

### Shipped

- Chat overlay, global hotkey, streaming, conversation history
- ReAct agent loop, 68 tools, risk-gated permission engine, audit trail
- Screen capture, OCR and vision description; audio transcription
- Headless browser automation (Playwright), sub-agents, cron scheduling
- Dashboard platform: free-placement widget canvas, printable guide
- Markets module: live quotes, formulas, sparklines
- News and dailies: local press review, custom journals, Supabase sharing, in-app admin console
- Hierarchical memory: vectors + BM25, warm facts, semantic cache, compaction
- Settings panel, safe mode, KV-cache auto-tuning, passive VRAM mode
- Offline installer (Inno Setup, disk-spanned), bootstrap downloader, signed auto-update

### In progress

- Test coverage on the untested edges — see [docs/AMELIORATIONS.md](docs/AMELIORATIONS.md)
- Distribution polish: installer size, first-run experience

### Later

- Plugin / extension system
- Voice input wired into the chat (the transcription tool already exists)
- Optional cloud model providers
- Linux and macOS support
- Self-evolving skills (the playbook store and evolution daemon lay the groundwork)

---

## Security

CatDesk treats **local** security as a first-class concern:

1. **Local inference** — every prompt goes to Ollama on `127.0.0.1`, never to a provider
2. **Capability-based shell** — Tauri 2 capabilities declare exactly what the webview may call
3. **Risk-gated tools** — each tool's level decides whether it runs, asks once, or waits
4. **Path confinement** — filesystem tools are restricted to allow-listed roots
5. **Command blocklist** — dangerous patterns are refused in Rust before execution
6. **Audit trail** — tool calls and side-effectful commands are logged with timestamp and args
7. **Safe mode** — one toggle blocks every medium-or-above tool
8. **Process isolation** — agent, OCR and Ollama are separate processes

**Deliberate outbound traffic.** CatDesk is not hermetic, and claiming otherwise would
itself be the security problem. It reaches the network for market quotes (Yahoo), shared
news and dailies (Supabase), the press review (RSS and news sites), auto-update (GitHub
Releases), and any tool you invoke that is explicitly about the network: `read_webpage`,
`call_api`, `send_webhook_message`, `read_email`, `github_*`, `browser_*`. Details in
[docs/SECURITE.md](docs/SECURITE.md).

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

```
Commit style   : conventional commits (feat/fix/chore/docs/refactor)
Branches       : dev = work in progress · master = last release, tagged vX.Y.Z
PR flow        : feat/* → dev, CI must be green · dev → master at release time
```

---

## License

MIT © 2026 CatDesk Contributors

---

<div align="center">
Built with ❤️ — Local AI, for everyone.
</div>
