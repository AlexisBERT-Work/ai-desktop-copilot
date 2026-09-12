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
| **Où en est le projet ?**                      | `docs/SUIVI.md` (§ « État actuel » en tête)                             |
| **Que reste-t-il à faire ?**                   | `docs/AMELIORATIONS.md` (§ 0 = ce qui bloque sur l'utilisateur)         |
| Que sait faire l'agent ? (68 outils + risques) | `docs/CAPACITES.md` — **référence unique**                              |
| Que ne sait-il pas faire ? Bornes matériel     | `docs/LIMITES.md`                                                       |
| Sécurité (sandbox, permissions, audit)         | `docs/SECURITE.md`                                                      |
| Installeur offline + auto-update               | `docs/DISTRIBUTION.md`                                                  |
| Techniques d'architecture agent (✅/🟡/⬜)     | `CATDESK-CONCEPTS-AVANCES.md` (référencé par le code : ne pas renommer) |
| Dashboard / bourse / news / dailys             | `docs/projects/dashboard.md` (décisions, non maintenu) + `supabase/`    |
| Choix de stack                                 | `docs/architecture/adr-*.md`                                            |
| Historique versionné                           | `CHANGELOG.md`                                                          |

Deux documents portent le suivi, et **un seul** répond à chaque question : SUIVI
= l'état, AMELIORATIONS = le reste à faire. Ne pas recréer un troisième point de
reprise : ce qui bloque va dans `AMELIORATIONS.md` § 0.

Matériel réel : AMD RX 6700, **10 Go VRAM**. Modèles (tri « un seul modèle, le
plus fort » — v0.1.3, 2026-08) : **`qwen3:14b` est le modèle de chat UNIQUE** du
bundle (chat + digests). `think:false` requis — pour les sorties JSON **et le
chat interactif** (sinon le raisonnement caché de qwen3 plombe la latence au
premier token). Le palier `qwen2.5:7b` a été **retiré du bundle** (machines
cibles ≥ ~10 Go VRAM) : plus de duo → plus de swap 14b↔7b, et
`recommend_default_model` renvoie toujours le 14b. `minicpm-v` (vision, PAS
llava — chargé à la demande ; seul swap restant : chat↔vision) ·
`nomic-embed-text` (embeddings). `qwen2.5-coder:14b` retiré (bot sans codage).
`CATDESK_MODEL_SMALL` reste un opt-in env (non injecté par le launcher).

Voix (mode « Jarvis », 2026-09) : **100 % CPU**, jamais de VRAM — `sherpa-onnx`
(VAD Silero + Parakeet TDT v3 + Piper `fr_FR-miro-high`) et `cpal`, tout en
Rust dans `core/voice/`. Modèles (~800 Mo) hors git :
`scripts/fetch-voice-models.ps1` → `%LOCALAPPDATA%\nd-voice-models`. Pocket
TTS et Kokoro **écartés** (plus lents que le temps réel en français sur ce
CPU), whisper.cpp/Vulkan et Kyutai STT écartés (VRAM). `SpeechRecognition` ne
marche pas dans WebView2 : ne pas réessayer côté webview.

KV-cache : **contradiction non tranchée** entre cette doc (« `q4_0` corrompt la
sortie sur ce GPU », incident 2026-06-15/16) et `commands/tuning.rs`, qui
l'active quand la VRAM est serrée — mesures à l'appui, scopé au process Ollama
de CatDesk et toujours avec `OLLAMA_FLASH_ATTENTION=1`. Sur la machine cible le
tuner renvoie donc `q4_0`. **Ne rien changer sans lire
`docs/AMELIORATIONS.md` §1.1**, qui décrit le test qui tranche.

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
- Compter/inventorier les outils agent :
  `packages/agent-runtime/src/tools/registerTools.ts` (registrations) — pas de
  scan du dossier `tools/`, et pas `index.ts`, qui n'en enregistre aucun.
- Lire les gros fichiers par tranches (`offset`/`limit`), pas en entier.

## Pièges de cet environnement (déjà payés, ne pas re-payer)

- **`node_modules/.bin/` est vide** (pnpm isolé) : passer par
  `pnpm --filter <package> exec <binaire>`, jamais par le chemin direct.
- **Les remplacements regex de masse sur du code sont dangereux** — trois dégâts
  sur la passe d'août 2026 (virgule mangée, ligne d'import effacée, fichier
  découpé sur une mauvaise frontière). **Toujours relire le diff** d'un
  remplacement automatisé.
- **La console Windows est en cp1252** : un `print` contenant une flèche Unicode
  fait planter un script Python de maintenance.

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
2. Declare a zod `argsSchema` and derive the JSON Schema from it
   (`schema = jsonSchemaFrom(argsSchema)`) — `argsSchema` is abstract, it is the
   single source for validation AND for the model's schema
3. Add permission config in `packages/shared-types/src/permissions.ts`
4. Register in `packages/agent-runtime/src/tools/registerTools.ts` (dev/infra tools
   also go in `RESEARCH_EXCLUDED` there)
5. Document it in `docs/CAPACITES.md`

`registerTools.test.ts` asserts registrations and permission entries match exactly.
Full procedure: `CONTRIBUTING.md`.

## TypeScript Conventions

- Strict mode + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`
- No `any` — use `unknown` and narrow
- Result pattern for fallible ops (never throw across module boundaries).
  `ToolResult` is a discriminated union — `if (result.success)` narrows
- Named exports only (no default except React components)
- Reuse the shared helpers instead of re-rolling one — c'est la raison d'être du
  refactoring d'août 2026, **importer au lieu de recopier** :
  - agent : `lib/runProcess` (jamais `promisify(execFile)`), `lib/httpGet`,
    `lib/dataDir`, `lib/readableText`, `lib/discord`, `llm/completion`
    (`complete`, `extractJsonObject`, `extractJsonArray`), `news/*` pour le
    vocabulaire « presse », `tools/base/testResult` (`expectOk`/`expectFail`)
  - desktop : `shared/ui/tokens.ts` (FIELD/OPTION/LABEL/BTN\_\*),
    `features/news/supabaseCrud.ts` (`makeTableCrud`),
    `features/dailies/useCrudConsole.ts` (machine à états des consoles admin)
  - Python : `ocr-vision/deps.py::require` pour les gardes de dépendances
- Domain code must NOT import from `tools/` — tools are call sites; shared
  vocabulary lives in `news/`, `llm/` or `lib/`

## Rust Conventions

- All Tauri commands are async and return `Result<T, String>`
- Relaying to the agent goes through `commands::forward_to_agent`
- `sandbox::check_path()` / `check_command()` before any filesystem/shell op.
  No command does either today — the filesystem/shell commands were removed as
  dead code — but the module is kept as the mandatory guard for any new one
- `audit::log()` AFTER any side-effectful operation succeeds
- User-facing errors go through `core::error::CatdeskError` (French).
  `.map_err(|e| e.to_string())` leaks raw OS/anyhow English — don't

## Dependencies: What Requires What

- Ollama must be running at `http://127.0.0.1:11434` before agent starts
- Python .venv must be activated for OCR sidecar: `packages/ocr-vision/.venv`
- Node.js ≥20, pnpm ≥9, Rust ≥1.78, Python ≥3.11
