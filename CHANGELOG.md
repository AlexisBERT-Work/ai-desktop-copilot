# Changelog

All notable changes to CatDesk are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) ·
Versioning: [Semantic Versioning](https://semver.org/)

Only `v0.1.0-beta.1` is tagged in git; the 0.1.x entries below are reconstructed from
the release commits and the shipped installers.

---

## [Unreleased]

### Fixed

- **Permission dialogs never resolved.** `permission.response`, emitted by Rust, had no
  handler in the agent's JSON-RPC dispatch and fell through to "method not found".
  `PermissionEngine.resolvePermissionRequest` — documented as "called from IPC bridge" —
  was called by nobody. Every `high`-risk tool (`run_command`, `open_app`,
  `schedule_task`) therefore hung for 60 s and failed with a timeout no matter what the
  user answered.
- **Tailwind never loaded its config.** `globals.css` uses the v4 `@import 'tailwindcss'`
  syntax, but `tailwind.config.ts` is a v3-style config, which v4 does not auto-discover
  without a `@config` directive. The whole `brand` palette (132 usages across 32 files)
  and the five custom animations produced no CSS at all.
- **The auto-update publishing path could not succeed.** `publish-update.ps1` looked for
  an NSIS installer and its `.sig` under `target/release/bundle/nsis`, while
  `build-release.ps1` always built with `--no-bundle`, which skips the bundler entirely.
  Update builds now bundle with NSIS (no model in the payload, so it fits) and the output
  directory is probed like `build-inno.ps1` does.
- **`setup.ps1` installed the wrong models** — it offered `qwen2.5:7b`, removed from the
  bundle in 0.1.3, and never pulled `qwen3:14b` or `minicpm-v`, leaving a fresh checkout
  unable to run.
- **`open_application` spawned an arbitrary process without `sandbox::check_command()`**,
  bypassing the blocklist. The command had no caller and was removed.
- `AuditLogger` wrote `"error": undefined` into every successful tool-call audit line.
- The Python sidecar answered `-32603` (internal error) for unknown methods and missing
  parameters, where JSON-RPC defines `-32601` and `-32602`. The TypeScript side already
  used the correct codes, so the two halves of one protocol disagreed.
- `csv_parser` imported `chardet` at module scope with no guard, so a missing optional
  dependency crashed at import instead of raising an actionable message on use.
- `Ctrl+N` called `preventDefault()` and then did nothing, silently disabling the shortcut.

### Changed

- **Removed 10 unused Tauri commands** (40 % of the IPC surface): `file_read`,
  `file_write`, `dir_list`, `system_run_command`, `open_application`, `clipboard_read`,
  `clipboard_write`, `screen_capture`, `screen_capture_active_window`,
  `get_ollama_models`. None had a caller; the agent performs these operations through its
  own tools and guards. `commands/screen.rs` went with them — both of its commands had
  returned an empty string since the MVP.
- **The press domain left the tool files.** `FetchTechNewsTool` was 737 lines for a
  45-line tool class, and ten modules under `news/` and `llm/` imported their vocabulary
  from tool files. Split into `news/{newsItem,sources,parseFeed,newsText,aggregate,enrich,discordEmbeds}`
  and `lib/{httpGet,readableText,discord}`; the tool is now 85 lines and no domain module
  imports from `tools/`.
- **`ToolResult` is a discriminated union**, so `if (result.success)` actually narrows.
- **The IPC method list has one source.** `AgentMethod` is derived from `RPC_METHODS`
  instead of being a hand-written union that had drifted in both directions — six
  phantom methods on one side, `permission.response` missing on the other.
- **15 tools now use `lib/runProcess`** instead of each re-declaring
  `promisify(execFile)`, which had silently lost `windowsHide` (a console window flashed
  on every git call) and the default timeout.
- Rust errors surface in French through a `CatdeskError` type, replacing 27
  `.map_err(|e| e.to_string())` that leaked raw OS text such as
  "The system cannot find the path specified. (os error 3)".
- Five side-effectful Tauri commands now write an audit line, including `update_settings`
  — which toggles `safeMode`, and so gates every medium-or-above tool.
- Shared front-end factories replace three copies of the Supabase CRUD boilerplate, two
  copies of an admin console state machine, and three copies of the style tokens.
- Documentation rewritten against the code: the tool count (67 → **68**), the model
  lineup, the project tree, the permission table (five of its example tools did not
  exist), the clone URL and the default branch were all wrong.

### Added

- `docs/AMELIORATIONS.md` — open decisions and known gaps, including the unresolved
  KV-cache `q4_0` contradiction between the docs and the code.
- Tests for `lib/runProcess`, the JSON-RPC dispatch (including a regression test for the
  permission bug), the Rust error type, and the Python dispatcher's error codes.

---

## [0.1.3] — 2026-08-05

### Changed

- **A single chat model: `qwen3:14b`.** The `qwen2.5:7b` tier was dropped from the
  bundle — the two do not fit together in 10 GB of VRAM, and every downgrade forced a
  10–20 s model swap that was slower than answering with the model already warm.
  `recommend_default_model` always returns the 14B.
- Interactive chat switched to `think:false`: qwen3's hidden reasoning was ruining
  time-to-first-token.
- Offline installer down to ~18 GB (from ~22).
- The bootstrap downloader was rewritten around `curl.exe` (much faster, with `-C -`
  resume) instead of `Invoke-WebRequest`.
- Modal text is selectable and copyable.

### Fixed

- `write_file` path guard no longer depends on the host OS.
- CI: Node 22 on the runners (pnpm 11.3 requires ≥ 22.13); removed a duplicate pnpm pin
  that blocked every job.

## [0.1.2] — 2026-07

### Fixed

- Auto-update pointed at a private repository, so anonymous clients got a 404. The
  endpoint now targets the public `catdesk-releases` repository.

## [0.1.1] — 2026-07

### Added

- Bootstrap installer that downloads the payload, for non-technical users.
- `-SingleFile` option for `build-inno.ps1` (payload under 4.2 GB).

### Fixed

- `build-release.ps1` long-path and empty-OCR failures.
- Version bumps that had been missed in `Cargo.toml` and the Inno `.iss`.

## [0.1.0] — 2026-06 → 2026-07

### Added

- **68 agent tools** across perception, code and git, connectors, system, browser,
  markets and automation — see `docs/CAPACITES.md`.
- **Dashboard platform**: configurable widget grid, later a free-placement canvas with
  saved layouts and per-widget styling; dedicated window; printable guide.
- **Markets module**: Yahoo quotes (~30 s), mathjs formulas, sparklines, watchlist synced
  with the sidecar, 5 agent tools.
- **News and dailies (Supabase)**: news banner, admin editorial feed (RLS), in-app admin
  console, interest filtering, server-side pagination.
- **Automatic press review**: daily digest per topic and per newspaper via the local LLM,
  custom admin journals (sources and regexes), cron publication, Discord mirror.
- **Hierarchical memory**: hybrid vector store (embeddings + BM25), warm memory store,
  fact extractor, consolidator, semantic cache.
- **Self-evolution**: playbook store and evolution daemon (proposals only, human in the
  loop), proactive spiral monitor.
- **Security**: `sanitizeToolOutput` (secret redaction and anti-injection spotlighting on
  tool output), risk-gated permission engine, Rust sandbox with path and command checks.
- Opt-in plan→execute loop, model router, vitest test base.

### Architecture

- Tauri 2 + React 19 + Rust + Node.js + Python
- JSON-RPC 2.0 IPC, ReAct agent loop
- In-house vector store (cosine + JSON). LanceDB was considered in early notes and never
  used; `SettingsWindow.test.tsx` carries an explicit regression test against it.
