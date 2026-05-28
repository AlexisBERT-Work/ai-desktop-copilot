# Contributing to NeuroDesk

Thank you for your interest in contributing! This document explains the development workflow and conventions.

## Development Setup

```powershell
git clone https://github.com/alexis.bert1412/ai-desktop-copilot.git
cd ai-desktop-copilot
.\scripts\setup.ps1
```

## Branch Strategy

```
main          ← stable releases only
  └── dev     ← integration branch (default PRs target here)
        ├── feat/chat-streaming
        ├── feat/ocr-integration
        ├── fix/permission-dialog
        └── chore/update-deps
```

**Branch naming:**
- `feat/<description>` — new features
- `fix/<description>` — bug fixes
- `chore/<description>` — maintenance, deps
- `docs/<description>` — documentation only
- `refactor/<description>` — code restructuring

## Commit Convention

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(chat): add streaming token display
fix(permissions): timeout pending requests on window close
chore(deps): update ollama client to 0.5.0
docs(readme): add Linux setup instructions
refactor(agent): extract system prompt builder
```

**Breaking changes:** add `!` after type, e.g. `feat(ipc)!: change JSON-RPC schema`

## Code Style

- **TypeScript strict mode** everywhere
- **No `any`** — use `unknown` and narrow types
- **Result<T, E>** pattern for fallible operations (never throw across module boundaries)
- **Named exports** only (no default exports except React components)
- **co-locate** tests next to source: `MyModule.test.ts` beside `MyModule.ts`

## Pull Request Process

1. Branch from `dev`
2. Run `pnpm type-check && pnpm lint && pnpm test` locally — all must pass
3. Keep PRs focused — one feature/fix per PR
4. Add tests for new tools and agent behaviors
5. Update relevant docs if you change public APIs

## Adding a New Tool

1. Create `packages/agent-runtime/src/tools/<category>/<ToolName>Tool.ts`
2. Implement `RegisteredTool` interface
3. Add schema to `packages/shared-types/src/tools.ts`
4. Register in `packages/agent-runtime/src/index.ts`
5. Add permission config in `packages/shared-types/src/permissions.ts`
6. Add tests in `packages/agent-runtime/src/tools/<category>/<ToolName>Tool.test.ts`
7. Document in `docs/tools/`

## Architecture Decisions

Major architectural changes require an ADR (Architecture Decision Record) in `docs/architecture/adr-NNN-<title>.md`.

## Security

**Never** commit:
- API keys or tokens
- Database files (`*.db`, `*.sqlite`)
- Audit logs
- `.env` files

If you discover a security vulnerability, please email directly rather than opening a public issue.
