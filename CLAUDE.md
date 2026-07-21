# CatDesk — CLAUDE.md

## Project Overview

Local-first AI desktop copilot. Tauri 2 (Rust) + React 19 + Node.js agent runtime + Python OCR sidecar.

## Monorepo Structure

- `apps/desktop/` — Tauri desktop app (React frontend + Rust backend)
- `packages/agent-runtime/` — Node.js AI agent sidecar (TypeScript)
- `packages/ocr-vision/` — Python OCR/vision/file parsing sidecar
- `packages/shared-types/` — Shared TypeScript types only

## Carte des documents (lire AVANT d'explorer — évite les recherches inutiles)

| Question                                       | Réponse dans                                                            |
| ---------------------------------------------- | ----------------------------------------------------------------------- |
| Que sait faire l'agent ? (68 outils + risques) | `docs/CAPACITES.md` — **référence unique**                              |
| Que ne sait-il pas faire ? Bornes matériel     | `docs/LIMITES.md`                                                       |
| État actuel + historique du travail            | `docs/SUIVI.md` (§ « État actuel » en tête)                             |
| Sécurité (sandbox, permissions, audit)         | `docs/SECURITE.md`                                                      |
| Installeur offline + auto-update               | `docs/DISTRIBUTION.md`                                                  |
| Techniques d'architecture agent (✅/🟡/⬜)     | `CATDESK-CONCEPTS-AVANCES.md` (référencé par le code : ne pas renommer) |
| Dashboard / bourse / news / dailys             | `docs/projects/` + `supabase/README.md`                                 |
| Choix de stack                                 | `docs/architecture/adr-*.md`                                            |
| `docs/archive/`                                | **Obsolète — ne jamais lire ni citer**                                  |

Matériel réel : AMD RX 6700, **10 Go VRAM**. Modèles (tri 2026-07-20 — UN seul
modèle de chat par machine, pas de palier léger ni de coder) : `qwen3:14b`
(chat + digests si ≥ 9 GiB VRAM — `think:false` requis pour les sorties JSON) ·
`qwen2.5:7b` (modèle principal des cartes < 9 GiB, PAS un palier de
rétrogradation : le swap VRAM 14b↔7b coûte 10-20 s) · `minicpm-v` (vision,
PAS llava, hors bundle) · `nomic-embed-text` (embeddings).
`qwen2.5-coder:14b` retiré (bot sans codage). `CATDESK_MODEL_SMALL` n'est plus
injecté par le launcher (opt-in env seulement).
Jamais de KV-cache `q4_0` global (corrompt la sortie sur ce GPU).

Dailys (revue de presse) : le lot standard se publie depuis **tout poste**
ayant lancé CatDesk (tri 2026-07-20, publication ouverte anon + RPC Postgres
`publish_daily_if_missing`, plus besoin d'attendre le poste admin) — voir
`supabase/README.md`. Identifiants admin = extras seulement (journaux
personnalisés, miroir Discord).

## Économie de tokens (règles de travail)

- **Ne jamais lire** : `pnpm-lock.yaml` (200 Ko), `node_modules/`,
  `packages/ocr-vision/.venv/`, `packages/ocr-vision/build-dist/` (bloqués via
  `.claude/settings.local.json`).
- **Glob ne respecte pas `.gitignore`** (il ressort node_modules/.venv) → préférer
  Grep (ripgrep, qui le respecte) ou `git ls-files`.
- Compter/inventorier les outils agent : `packages/agent-runtime/src/index.ts`
  (registrations) — pas de scan du dossier `tools/`.
- Lire les gros fichiers par tranches (`offset`/`limit`), pas en entier.

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
