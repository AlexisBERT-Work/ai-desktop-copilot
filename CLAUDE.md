# CatDesk — CLAUDE.md

## Project Overview
Local-first AI desktop copilot. Tauri 2 (Rust) + React 19 + Node.js agent runtime + Python OCR sidecar.

## Monorepo Structure
- `apps/desktop/` — Tauri desktop app (React frontend + Rust backend)
- `packages/agent-runtime/` — Node.js AI agent sidecar (TypeScript)
- `packages/ocr-vision/` — Python OCR/vision/file parsing sidecar
- `packages/shared-types/` — Shared TypeScript types only

## Key Commands
```powershell
pnpm dev              # Start full dev environment (Tauri + sidecars)
pnpm type-check       # TypeScript check all packages
pnpm lint             # Lint all packages
pnpm test             # Run all tests
.\scripts\setup.ps1   # First-time dev setup
```

## Architecture Rules
1. **UI never calls sidecars directly** — always via Tauri IPC commands/events
2. **Rust validates all inputs** — sandbox.rs checks paths and commands before execution
3. **Agent tools must extend BaseTool** — located in `packages/agent-runtime/src/tools/`
4. **All tool calls are audited** — AuditLogger records every execution
5. **Permissions are risk-gated** — low=auto, medium=once, high=confirm, critical=disabled

## IPC Flow
```
React → tauri invoke() → Rust handler → JSON-RPC → Node.js agent
Node.js agent → stdout NDJSON → Rust bridge → Tauri emit() → React
```

## Adding a New Tool
1. Create `packages/agent-runtime/src/tools/<category>/<Name>Tool.ts` extending `BaseTool`
2. Add schema to `packages/shared-types/src/tools.ts`
3. Add permission config in `packages/shared-types/src/permissions.ts`
4. Register in `packages/agent-runtime/src/index.ts`

## TypeScript Conventions
- Strict mode + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`
- No `any` — use `unknown` and narrow
- Result pattern for fallible ops (never throw across module boundaries)
- Named exports only (no default except React components)

## Rust Conventions
- All Tauri commands are async and return `Result<T, String>`
- `sandbox::check_path()` and `sandbox::check_command()` before any filesystem/shell op
- `audit::log_*()` after any side-effectful operation
- Error messages in French (user-facing)

## Dependencies: What Requires What
- Ollama must be running at `http://127.0.0.1:11434` before agent starts
- Python .venv must be activated for OCR sidecar: `packages/ocr-vision/.venv`
- Node.js ≥20, pnpm ≥9, Rust ≥1.78, Python ≥3.11
