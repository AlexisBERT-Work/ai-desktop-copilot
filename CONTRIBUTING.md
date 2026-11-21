# Contributing to CatDesk

Thank you for your interest. This document covers the workflow and the conventions the
codebase actually follows.

## Development setup

```powershell
git clone https://github.com/AlexisBERT-Work/ai-desktop-copilot.git
cd ai-desktop-copilot
.\scripts\setup.ps1
```

Prerequisites and model setup are in the [README](README.md#quick-start). Node 22 and
pnpm 11.3 are hard floors, not suggestions — CI builds with exactly those.

### A second machine

Git carries the code, not the local state. On another machine, after `setup.ps1`:

| What                                                    | Where                                  | How                                                                                                                      |
| ------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Supabase URL + anon key for the webview (news, dailies) | `apps/desktop/.env`                    | Copy it from the first machine, or fill in `.env.example`. Without it the news panels stay empty.                        |
| Discord webhooks, Supabase admin account (extras only)  | `packages/agent-runtime/.env`          | Copy it from the first machine. Without it the standard press digest still publishes.                                    |
| Voice models (~800 MB)                                  | `%LOCALAPPDATA%\nd-voice-models`       | `powershell -File scripts\fetch-voice-models.ps1`                                                                        |
| Ollama models                                           | Ollama's store                         | `setup.ps1` offers to pull them, or the three `ollama pull` in the README.                                               |
| Rust build directory (optional)                         | `CARGO_TARGET_DIR` user variable       | e.g. `%LOCALAPPDATA%\nd-target`: keeps several GB of build output (sherpa-onnx alone extracts ~1.2 GB) out of the clone. |
| Update signing key — only to run `publish-update.ps1`   | `%USERPROFILE%\.tauri\catdesk.key`     | Copy it by USB, never through git or a synced folder. Its password is stored nowhere: you type it.                       |
| Agent memory and conversations                          | `%APPDATA%\com.catdesk.app\agent-data` | Starts empty. Copy it only to keep the history.                                                                          |

The latency figures in `docs/SUIVI.md` were measured on an RX 6700 (10 GB of VRAM), which
is about what `qwen3:14b` needs. With less VRAM, Ollama spills layers to the CPU and every
answer gets slower: compare on the new machine with `node scripts/latency-bench.mjs`.

## Branches

Two long-lived branches:

- **`dev`** — where work happens. Branch from it and open your PR against it.
- **`master`** — the last releasable state. It only moves when `dev` is merged in for a
  release, and every release is tagged `vX.Y.Z` there. Committing to `master` never
  ships anything by itself: installed apps only update when `scripts/publish-update.ps1`
  is run by hand (release cycle: [docs/DISTRIBUTION.md](docs/DISTRIBUTION.md) § 4).

Work parked for a later milestone is kept under an `archive/*` tag rather than a stale
branch. The 0.1.x line (no voice) is frozen at tag `v0.1.3`; a fix there would branch
from that tag as `maint/0.1.x`.

```
feat/<description>      new features
fix/<description>       bug fixes
refactor/<description>  restructuring, no behaviour change
chore/<description>     maintenance, dependencies
docs/<description>      documentation only
```

## Commit convention

[Conventional Commits](https://www.conventionalcommits.org/):

```
feat(chat): add streaming token display
fix(permissions): route permission.response to the agent
refactor(agent): move press domain out of tool files
docs(readme): correct the tool count
```

Breaking changes get a `!`: `feat(ipc)!: change JSON-RPC schema`.

Write the body for someone reading `git log` in six months: say what was wrong, not just
what you changed.

## Code style

- **TypeScript strict**, plus `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`
- **No `any`** — use `unknown` and narrow. There are currently zero in production code;
  keep it that way. `any` is allowed in tests.
- **Result pattern** for fallible operations. `ToolResult` is a discriminated union, so
  `if (result.success)` narrows — don't defeat it by re-checking.
- **Named exports only** (React components excepted)
- **Co-locate tests**: `MyModule.test.ts` beside `MyModule.ts`
- Prefer the shared helpers over re-rolling one: `lib/runProcess` (never
  `promisify(execFile)` again), `lib/http` (never a bare `fetch`: it has no timeout
  and no size cap), `lib/persistence` (atomic writes, `SqliteFile`), `lib/dataDir`,
  `llm/completion`, `memory/embedding`, `news/supabaseRest`, `lifecycle.ts`. The full
  list is in [CLAUDE.md](CLAUDE.md).

Run `pnpm format` before pushing; a pre-commit hook runs ESLint and Prettier on staged
files.

## Pull requests

1. Branch from `dev`
2. Run the full gate locally — all of it must pass:
   ```powershell
   pnpm type-check
   pnpm lint
   pnpm test
   pnpm format:check                             # also run in CI
   cargo test   --manifest-path apps/desktop/src-tauri/Cargo.toml
   cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --lib --tests -- -D warnings
   cargo fmt --check --manifest-path apps/desktop/src-tauri/Cargo.toml
   cd packages/ocr-vision; python -m pytest -q
   ```
3. Keep PRs focused — one feature or fix each
4. Add tests for new tools and agent behaviour
5. Update the docs you invalidate (see the map in [CLAUDE.md](CLAUDE.md))

## Adding a new tool

1. Create `packages/agent-runtime/src/tools/<category>/<Name>Tool.ts`, extending
   `BaseTool`.
2. Declare a zod `argsSchema` and derive the JSON Schema from it:
   `schema = jsonSchemaFrom(argsSchema)`. This is mandatory — `argsSchema` is abstract on
   `BaseTool`, and it is the single source for validation and for the model's schema.
   List every filesystem-path argument in `override readonly pathArgs = [...] as const`:
   the permission engine checks only declared paths against the whitelist.
3. Add the matching entry to `DEFAULT_PERMISSION_CONFIG` in
   `packages/shared-types/src/permissions.ts`, with a risk level.
4. Register it in `packages/agent-runtime/src/tools/registerTools.ts` (**not**
   `index.ts` — registration moved out of it). If the tool is developer- or
   infra-oriented, add its name to `RESEARCH_EXCLUDED` in the same file.
5. Add `packages/agent-runtime/src/tools/<category>/<Name>Tool.test.ts`. Use
   `expectOk` / `expectFail` from `tools/base/testResult` so assertions narrow.
6. Document it in `docs/CAPACITES.md` — the tool catalogue's single source of truth.

`registerTools.test.ts` asserts that registrations and permission entries match exactly,
so steps 3 and 4 fail loudly if you skip one — and it fails on a path-like argument
(`path`, `dir`, `file`, `vault`…) missing from `pathArgs`.

## Keeping the layers honest

Three invariants are enforced by tooling rather than review. If you find yourself
fighting one, that is the signal:

- **No `invoke()` outside `apps/desktop/src/shared/api/`** — ESLint blocks the import.
- **The Rust IPC mirror must match `shared-types/src/ipc-contract.ts`** — a `cargo test`
  reads that file with `include_str!`.
- **Domain code must not import from `tools/`.** Tools are call sites; shared vocabulary
  belongs in `news/`, `llm/` or `lib/`.

## Architecture decisions

Significant changes get an ADR in `docs/architecture/adr-NNN-<title>.md`. ADRs are not
rewritten — supersede them with a note instead.

## Security

**Never** commit API keys or tokens, database files (`*.db`, `*.sqlite`), audit logs, or
`.env` files.

If you find a security vulnerability, email directly rather than opening a public issue.
