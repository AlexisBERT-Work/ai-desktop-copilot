# NeuroDesk — AI Desktop Copilot

<div align="center">

![NeuroDesk Banner](docs/assets/banner.png)

**Local-first AI desktop copilot. Powerful. Private. Extensible.**

[![License: MIT](https://img.shields.io/badge/License-MIT-purple.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue.svg)](https://www.typescriptlang.org/)
[![Rust](https://img.shields.io/badge/Rust-1.78-orange.svg)](https://www.rust-lang.org/)
[![Tauri](https://img.shields.io/badge/Tauri-2.x-24C8D8.svg)](https://tauri.app/)
[![Ollama](https://img.shields.io/badge/Ollama-local%20LLM-black.svg)](https://ollama.com/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

[Features](#features) · [Architecture](#architecture) · [Quick Start](#quick-start) · [Roadmap](#roadmap) · [Contributing](#contributing)

</div>

---

## What is NeuroDesk?

NeuroDesk is a **local AI desktop copilot** that runs entirely on your machine — no cloud, no data sent anywhere, no subscriptions. It provides a floating AI assistant that can see your screen, analyze files, run commands, and automate tasks, all powered by local LLMs via [Ollama](https://ollama.com/).

> **"Powerful locally, private by design, extensible by nature"**

---

## Features

### 🗨️ Chat Assistant
- Modern floating overlay (always-on-top)
- Global hotkey activation (`Ctrl+Space` by default)
- Conversation history with persistence
- Token-by-token streaming responses
- Full Markdown + syntax-highlighted code blocks
- Drag & drop file attachments

### 🤖 Local LLM Integration
- [Ollama](https://ollama.com/) backend (100% local)
- Supported models: **Qwen**, **Llama 3**, **DeepSeek**, **Mistral**
- Dynamic model selection per conversation
- Context window management with smart trimming
- RAG over your personal documents

### 👁️ Screen Reading
- Full or partial screen capture
- Local OCR (Tesseract)
- Active window context detection
- Automatic screen context injection in prompts

### 📁 File Analysis
- PDF, DOCX, TXT, CSV, JSON, source code
- Summarize, extract, search semantically
- Drag & drop into chat

### ⚙️ System Automation
- PowerShell & CMD execution (sandboxed)
- Open/close applications
- Window management
- Clipboard manager
- Task scheduling

### 🧠 Memory & RAG
- Persistent conversation history (SQLite)
- Semantic memory (LanceDB vector store)
- Personal knowledge base from imported documents
- Automatic relevant memory retrieval

### 🔒 Security First
- Capability-based permissions (Tauri 2)
- Risk-level gating (auto / once / confirm / explicit)
- Path whitelisting for filesystem access
- Full audit logs
- Safe mode (blocks all medium+ risk tools)
- No arbitrary code execution without validation

---

## Architecture

```
┌══════════════════════════════════════════════════════════════════╗
║                    NEURODESK ARCHITECTURE                        ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  ┌──────────────────────────────────────────────────────────┐   ║
║  │                    PRESENTATION LAYER                     │   ║
║  │  React UI  │  Overlay  │  Command Palette  │  Tray Menu  │   ║
║  └─────────────────────────┬────────────────────────────────┘   ║
║                            │ Tauri IPC (typed commands)          ║
║  ┌─────────────────────────▼────────────────────────────────┐   ║
║  │                    APPLICATION LAYER                      │   ║
║  │  ChatService │ AgentService │ WorkflowEngine │ ContextMgr │  ║
║  └─────────────────────────┬────────────────────────────────┘   ║
║                            │ Domain Events (EventBus)            ║
║  ┌─────────────────────────▼────────────────────────────────┐   ║
║  │                      DOMAIN LAYER                         │   ║
║  │  Agent Entity │ Tool Registry │ Memory Store │ Conv. Repo │  ║
║  └─────────────────────────┬────────────────────────────────┘   ║
║                            │ Ports (abstract interfaces)         ║
║  ┌─────────────────────────▼────────────────────────────────┐   ║
║  │                   INFRASTRUCTURE LAYER                    │   ║
║  │  Ollama │ LanceDB │ Tesseract │ WinAPI/PowerShell          │  ║
║  └──────────────────────────────────────────────────────────┘   ║
╚══════════════════════════════════════════════════════════════════╝
```

### IPC Stack

```
React (TypeScript)
    │ Tauri invoke/events (type-safe)
Rust Core (Tauri 2)
    │ JSON-RPC 2.0 over stdin/stdout
Node.js Agent Runtime (sidecar)
    │ JSON-RPC 2.0 over stdin/stdout
Python OCR/Vision (sidecar)
    │ HTTP REST + SSE
Ollama (local LLM server)
```

### Agent Loop (ReAct Pattern)

```
User Input → Context Builder → LLM Call → Response Parser
                                               │         │
                                          Direct Text  Tool Call
                                               │         │
                                          Stream UI  Permission Gate
                                                         │
                                                    Tool Executor
                                                    (sandboxed)
                                                         │
                                                  Result → LLM (loop)
                                                         │
                                                  Final Response
```

### Permission Model

| Risk Level | Behavior | Examples |
|-----------|----------|---------|
| 🟢 **Low** | Auto-execute, logged | read_file, capture_screen, OCR |
| 🟡 **Medium** | Ask once per session | write_clipboard, open_app, write_file |
| 🟠 **High** | Confirm every time | run_command, close_window, send_keys |
| 🔴 **Critical** | Disabled by default | delete_file, run_as_admin, registry |

---

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Desktop Shell | **Tauri 2.x** | 8MB bundle, native security model, Rust core |
| Frontend | **React 19 + TypeScript** | Concurrent rendering, streaming UI |
| Styling | **Tailwind CSS 4 + shadcn/ui** | Fast, accessible, tree-shaken |
| State | **Zustand + Immer** | Lightweight, devtools-friendly |
| Animations | **Framer Motion** | Fluid overlay transitions |
| Core Runtime | **Rust** | Memory safety, native syscalls, speed |
| Agent Runtime | **Node.js (sidecar)** | npm AI ecosystem, tool prototyping |
| LLM | **Ollama** | Best local LLM runner, multi-model |
| OCR | **Tesseract (Python)** | Mature, multilingual, local |
| Vector DB | **LanceDB** | Embedded, no server, Rust-native |
| File Parsing | **Python (pypdf, python-docx)** | Mature document libraries |
| Automation | **PowerShell + WinAPI (Rust)** | Native Windows control |
| Monorepo | **pnpm + Turborepo** | Fast builds, workspace linking |

---

## Project Structure

```
ai-desktop-copilot/
├── apps/
│   └── desktop/                    # Tauri desktop app
│       ├── src-tauri/              # Rust backend
│       │   ├── src/
│       │   │   ├── commands/       # IPC handlers (chat, screen, fs, system)
│       │   │   ├── core/           # permissions, sandbox, audit, hotkeys
│       │   │   ├── ipc/            # event definitions, Node.js bridge
│       │   │   └── platform/       # Windows/Linux/macOS specifics
│       │   └── capabilities/       # Tauri capability declarations
│       └── src/                    # React frontend
│           ├── features/
│           │   ├── chat/           # Chat window, streaming, history
│           │   ├── overlay/        # FloatingOverlay, MiniMode, CommandPalette
│           │   ├── agent/          # AgentPanel, ToolCallCard, PermissionPrompt
│           │   ├── memory/         # ContextViewer, KnowledgeBase
│           │   └── settings/       # Model, permissions, hotkeys settings
│           └── shared/             # UI components, hooks, tauri API
│
├── packages/
│   ├── agent-runtime/              # Node.js Agent Engine (sidecar)
│   │   └── src/
│   │       ├── AgentOrchestrator.ts
│   │       ├── ToolRegistry.ts
│   │       ├── ContextManager.ts
│   │       ├── tools/              # filesystem, system, screen, clipboard, memory
│   │       ├── llm/                # Ollama client, streaming, prompt builder
│   │       ├── memory/             # SQLite conversations, LanceDB vectors
│   │       └── permissions/        # Permission engine
│   │
│   ├── ocr-vision/                 # Python OCR/Vision sidecar
│   │   ├── ocr/                    # Tesseract engine, preprocessor
│   │   ├── vision/                 # Screenshot, window detection
│   │   ├── files/                  # PDF, DOCX, CSV, code parsers
│   │   └── embeddings/             # sentence-transformers
│   │
│   ├── shared-types/               # Shared TypeScript types (IPC, agents, events)
│   └── config/                     # Shared ESLint, TSConfig, Tailwind config
│
├── scripts/
│   ├── setup.ps1                   # Full Windows dev setup
│   ├── build.ps1                   # Production build
│   └── dev.ps1                     # Start dev environment
│
└── docs/
    ├── architecture/               # Detailed architecture docs
    ├── api/                        # IPC API reference
    └── tools/                      # Tool catalog
```

---

## Quick Start

### Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | ≥ 20 | [nodejs.org](https://nodejs.org) |
| pnpm | ≥ 9 | `npm i -g pnpm` |
| Rust | ≥ 1.78 | [rustup.rs](https://rustup.rs) |
| Python | ≥ 3.11 | [python.org](https://python.org) |
| Ollama | latest | [ollama.com](https://ollama.com) |
| WebView2 | latest | Pre-installed on Windows 11 |

### 1. Clone & Setup

```powershell
git clone https://github.com/alexis.bert1412/ai-desktop-copilot.git
cd ai-desktop-copilot
.\scripts\setup.ps1
```

### 2. Pull LLM Models

```powershell
ollama pull qwen2.5:7b        # Main chat model
ollama pull nomic-embed-text  # Embeddings for RAG
```

### 3. Start Dev

```powershell
pnpm dev
```

This starts:
- Tauri dev window (hot reload)
- Node.js agent runtime (sidecar)
- Python OCR service (sidecar)
- Ollama (must be running separately)

### 4. Open NeuroDesk

Press `Ctrl+Space` anywhere to open the overlay.

---

## Roadmap

### ✅ Phase 0 — Foundation (Weeks 1-2)
- [x] Monorepo setup (pnpm + Turborepo)
- [x] Tauri 2 + React 19 scaffold
- [x] Shared types package
- [x] CI/CD pipeline
- [x] Project structure

### 🔨 Phase 1 — MVP Core (Weeks 3-6)
- [ ] Ollama streaming client
- [ ] Chat UI (messages, streaming, history)
- [ ] Always-on-top window + global hotkey
- [ ] Model selector
- [ ] Agent ReAct loop
- [ ] 5 core tools (read_file, list_dir, run_command, capture_screen, clipboard)
- [ ] Permission dialog
- [ ] Audit logging

### 🔨 Phase 2 — Features (Weeks 7-12)
- [ ] OCR + screen context
- [ ] Semantic memory (LanceDB RAG)
- [ ] Document import (PDF, DOCX, CSV)
- [ ] Command palette
- [ ] Mini floating mode
- [ ] System tray

### 🔨 Phase 3 — Polish & Automation (Weeks 13-18)
- [ ] PowerShell workflow runner
- [ ] Workflow builder UI
- [ ] Full settings panel
- [ ] Safe mode
- [ ] Auto-updater
- [ ] Performance optimization

### 🚀 V2 (Post-MVP)
- [ ] Plugin/extension system
- [ ] Voice input (Whisper local)
- [ ] Multi-agent support
- [ ] Optional OpenAI/Anthropic API
- [ ] Linux / macOS support
- [ ] Workflow marketplace

---

## Agent Tools Catalog

| Tool | Category | Risk | Description |
|------|----------|------|-------------|
| `read_file` | filesystem | 🟢 Low | Read file content |
| `list_directory` | filesystem | 🟢 Low | List directory contents |
| `search_files` | filesystem | 🟢 Low | Search files by name/content |
| `capture_screen` | screen | 🟢 Low | Full or partial screenshot |
| `ocr_region` | screen | 🟢 Low | OCR text from screen region |
| `get_active_window` | screen | 🟢 Low | Get active window info |
| `read_clipboard` | clipboard | 🟢 Low | Read clipboard content |
| `search_memory` | memory | 🟢 Low | Semantic memory search |
| `write_file` | filesystem | 🟡 Medium | Write/create file |
| `write_clipboard` | clipboard | 🟡 Medium | Write to clipboard |
| `open_app` | system | 🟡 Medium | Open application |
| `store_memory` | memory | 🟡 Medium | Store fact in memory |
| `run_command` | system | 🟠 High | Execute PowerShell/CMD |
| `close_window` | system | 🟠 High | Close application window |
| `send_keys` | automation | 🟠 High | Send keyboard input |
| `schedule_task` | automation | 🟠 High | Schedule system task |
| `delete_file` | filesystem | 🔴 Critical | Delete file (disabled by default) |
| `run_as_admin` | system | 🔴 Critical | Elevate privileges (disabled) |

---

## Security

NeuroDesk is designed with **local security** as a first-class concern:

1. **No network egress** — All LLM inference is local via Ollama
2. **Capability-based model** — Tauri 2 granular capability declarations
3. **Risk-gated tools** — Every tool has a risk level with corresponding UX
4. **Path whitelisting** — Filesystem tools are restricted to allowed paths
5. **Command sanitization** — Rust-level blocklist for dangerous patterns
6. **Audit trail** — Every tool call is logged with timestamp, args, result
7. **Safe mode** — One toggle to block all medium+ risk operations
8. **Process isolation** — Agent, OCR sidecars run as separate processes

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines.

```
Commit style : conventional commits (feat/fix/chore/docs/refactor)
Branch model : main (stable) / dev (integration) / feat/* / fix/*
PR flow      : feat/* → dev → main (with review)
```

---

## License

MIT © 2026 NeuroDesk Contributors

---

<div align="center">
Built with ❤️ — Local AI, for everyone.
</div>
