# Changelog

All notable changes to CatDesk are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) ·
Versioning: [Semantic Versioning](https://semver.org/)

From 0.2.0 on, every published version is tagged `vX.Y.Z` on `master`. Before that only
`v0.1.0-beta.1` and `v0.1.3` were tagged; the other 0.1.x entries below are reconstructed
from the release commits and the shipped installers.

---

## [Unreleased]

Full audit and refactor of the whole repository (branch `refactor/audit-complet`). Details
and the remaining items: `docs/SUIVI.md` (2026-10-07) and `docs/AMELIORATIONS.md`.

### Fixed

- **The agent could not see the shared dailies on an installed machine.** The Supabase URL
  and anon key were only read from `.env`, which an installer does not ship; the public
  defaults now live in `config.ts` and an empty variable counts as absent.
- **The conversation context kept the 40 _oldest_ messages** instead of the most recent
  ones, so long conversations lost their latest turns.
- **A permission prompt that timed out failed the whole run.** A timeout or a Stop now
  counts as a refusal and the agent carries on without the tool; the UI dismisses the
  dialog at the same moment, queues concurrent requests and shows what is being asked.
- **An internal agent error left the UI stuck on "thinking…".** It is now reported as a
  chat error (`INTERNAL`) and audited.
- **An answer cut short by Stop was cached** and could later be served as complete.
- **Ollama outlived CatDesk**, and the next launch took the orphan for an external server,
  so the KV-cache tuning no longer applied. CatDesk now stops the Ollama it started (and
  the agent) on exit and before installing an update.
- **The agent was never restarted after a crash.** Rust supervises it (exponential
  backoff, at most 5 restarts), replays the runtime settings after each spawn and reports
  a run lost mid-way (`AGENT_EXITED`) instead of leaving it hanging.
- **Safe mode could be off in the agent while the UI showed it on** when the agent started
  late; settings are replayed as soon as the bridge is up.
- **Settings › Model had no effect**: model, temperature and max iterations were saved but
  never sent. "Automatic" follows the recommended model.
- Embeddings were disabled for the whole session after one failure; they now pause for a
  minute and retry. The vector store caps auto-indexed exchanges at 2,000.
- The memory consolidation (6 h) and evolution (24 h) daemons never reached their first
  run; a cancelled cron job could come back to life.
- HTTP: redirects and oversized bodies were handled differently by seven hand-rolled
  clients; `call_api` treated `[::1]` as remote.
- Python sidecar logs were invalid JSON as soon as a message contained a quote or a
  newline.
- Four PowerShell scripts with non-ASCII text had no BOM and were read as cp1252.

### Security

- **Path arguments are declared per tool** (`BaseTool.pathArgs`) and all of them are
  checked against the whitelist. `obsidian_notes` (`vault`) and `semantic_search`
  (`paths`), both auto-approved, could read any folder on the disk.
- **The audit log is redacted by key name**: IMAP passwords, GitHub/Notion/`call_api`
  tokens, SQL connection strings and webhook URLs were written in clear text.
- **`run_sqlite` refuses CLI dot-commands** (`.shell`, `.system`, `.output`…), which ran
  system commands behind a medium-risk tool, and `db_path` values starting with `-`.
- **mathjs formulas are sandboxed**: `import`, `createUnit`, `evaluate`, `parse`,
  `simplify`, `derivative`, `resolve` and `compile` are disabled.
- **`post_tech_news_discord` only posts to Discord webhooks.**
- **Smaller webview surface**: the CSP no longer allows the Ollama port, and the
  capabilities drop `set-always-on-top`, notifications, global shortcuts and the updater
  (all driven from Rust). The unused notification plugin is removed.

### Changed

- **Agent runtime restructured around shared modules**: one HTTP client (`lib/http`, on
  `fetch`, bounded time and size), one persistence layer (`lib/persistence`: atomic
  writes, `SqliteFile`; a corrupt database is set aside instead of blocking startup),
  `news/supabaseRest` (one anonymous sign-in, timeouts), `memory/embedding`,
  `lifecycle.ts` (ordered shutdown on SIGTERM/SIGINT/stdin close), an orchestrator with
  named dependencies and a JSON-RPC bridge with a single error path.
- Default model names and the Ollama URL live in `@catdesk/shared-types` (`models.ts`),
  mirrored in Rust under test.
- Desktop: a real `vitest.config.ts` and test setup (jest-dom), atomic Zustand selectors
  everywhere, a versioned settings store with a tested migration, `tsconfig.node.json`
  extends the base config, remaining English UI strings translated.
- Prettier now covers the whole repository and `pnpm format:check` runs in CI.
- Tests: ~700 agent (was 640), 54 desktop (was 47), 34 Rust (was 32), 14 Python (was 7).

## [0.2.0] — 2026-09-12

> **Two release lines from here on.** 0.2.x is the voice line and self-updates from the
> public `catdesk-releases-voice` repository. The 0.1.x installers already in the field
> keep polling `catdesk-releases`, which stays **frozen at 0.1.3** (git tag `v0.1.3`):
> they are deliberately _not_ upgraded to 0.2.x. `publish-update.ps1` now reads the
> target repository from the updater endpoint baked into the build and refuses any
> other, so a 0.2.x build cannot be published where 0.1.x users look. Details and the
> rationale: `docs/DISTRIBUTION.md` § 0 bis.

### Added

- **Widget guide redesigned.** Numbered table of contents (gestures, "I want…", widgets,
  formulas, origins, shortcuts) tracked while scrolling, full-text filter over the
  widgets with a highlight on arrival, `Escape` clears the filter then closes, instant
  scrolling under `prefers-reduced-motion`. The content moved to `guideContent.tsx`.
- **Talk to CatDesk, hear it answer ("Jarvis" mode, phase 1).** `Ctrl+Space` opens the
  bubble and the microphone; the utterance ends on 0.7 s of silence, is transcribed
  locally and sent as a chat message; the answer is read aloud sentence by sentence
  while the model is still writing. Everything runs on the **CPU** through a single
  Rust dependency, `sherpa-onnx` (Silero VAD, Parakeet TDT 0.6B v3 for recognition —
  French WER 4.97 %, better than Whisper large-v3 — and Piper `fr_FR-miro-high` for
  synthesis), so the GPU stays entirely with `qwen3:14b`. Measured on a Ryzen 5 5500:
  5 s of speech transcribed in 0.3 s, first audio in 83 ms. New Tauri commands
  `voice_*`, events `voice:state|transcript|level`, a **Voice** settings tab, a mic
  button in the bubble and the chat, and `window.speechSynthesis` as the fallback voice
  when the models are missing. Models (~800 MB) are staged by
  `scripts/fetch-voice-models.ps1` and bundled by `build-release.ps1` (`-SkipVoice`
  to opt out). Not yet: wake word, barge-in, spoken-style answers — see
  `docs/AMELIORATIONS.md` § 4.
- `CatdeskError::Audio` — French wording for microphone / speaker / voice-model failures.

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
- **One command sets the version.** It is written in 9 places (four `package.json`,
  `tauri.conf.json`, `Cargo.toml`/`Cargo.lock`, both Inno scripts) and
  `publish-update.ps1` used to bump only `tauri.conf.json`, leaving the rest stale — the
  root `package.json` still said 0.1.3. New `scripts/bump-version.ps1` rewrites each
  field through a scoped regex and refuses a version that does not go up;
  `publish-update.ps1` no longer bumps anything and refuses to publish unless the repo
  already carries the requested version, so every published build matches a commit.
- **Branch model**: work happens on `dev`, `master` holds the last release and is tagged
  `vX.Y.Z`. The release cycle is in `docs/DISTRIBUTION.md` § 4, the planned versions in
  `docs/AMELIORATIONS.md` § 0 bis.

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
