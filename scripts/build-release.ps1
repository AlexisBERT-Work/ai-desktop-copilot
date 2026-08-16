<#
.SYNOPSIS
  Build a fully self-contained, offline CatDesk installer (.exe) for Windows.

.DESCRIPTION
  Stages every runtime dependency into apps/desktop/src-tauri/resources/ then
  produces an NSIS installer that needs NOTHING on the target machine — no Node,
  no Python, no Ollama, no internet:

    resources/agent/   node.exe + bundled agent (dist/index.js) + node_modules
    resources/ollama/  ollama.exe + the model blobs
    resources/ocr/     PyInstaller OCR sidecar + tessdata   (skippable)

  The resulting installer is LARGE (the LLM model alone is several GB). It can
  only be shared via USB / cloud link, not email.

.PARAMETER SkipOcr
  Don't build/bundle the Python OCR sidecar (smaller, faster build).

.PARAMETER ModelsPath
  Source Ollama models directory. Default: $env:USERPROFILE\.ollama\models
  Tip: prune unused models there first to shrink the installer.

.PARAMETER Update
  Build a lightweight UPDATE artifact: everything EXCEPT the multi-GB model
  (which already lives in each user's persistent store, seeded by their initial
  install). Used by scripts/publish-update.ps1. Requires the signing env vars
  TAURI_SIGNING_PRIVATE_KEY and TAURI_SIGNING_PRIVATE_KEY_PASSWORD to be set so
  the .sig updater artifact is produced.

.EXAMPLE
  pwsh -File scripts/build-release.ps1            # full offline installer
  pwsh -File scripts/build-release.ps1 -SkipOcr   # full, no OCR
  pwsh -File scripts/build-release.ps1 -Update    # small update artifact
#>
[CmdletBinding()]
param(
  [switch]$SkipOcr,
  [switch]$Update,
  [string]$ModelsPath = (Join-Path $env:USERPROFILE ".ollama\models")
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot          # repo root
$tauriDir = Join-Path $root "apps\desktop\src-tauri"
$resDir = Join-Path $tauriDir "resources"
$releaseConf = Join-Path $tauriDir "tauri.release.conf.json"

function Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }
function Need($name) {
  $c = Get-Command $name -ErrorAction SilentlyContinue
  if (-not $c) { throw "Prerequisite missing: '$name' not found in PATH." }
  return $c.Source
}
# Remove-Item échoue (« chemin d'accès introuvable ») sur des chemins > 260
# caractères — arrive avec un resources/agent d'un build précédent à cette
# limite (ex. avant l'exclusion eslint/typescript ci-dessous). Robocopy gère
# nativement les chemins longs : miroiter un dossier source vide vide la
# cible en profondeur, après quoi le dossier (désormais vide) se supprime
# normalement.
function Remove-DirRobust($path) {
  if (-not (Test-Path $path)) { return }
  $empty = Join-Path $env:TEMP "nd-empty-$([guid]::NewGuid())"
  New-Item -ItemType Directory -Force -Path $empty | Out-Null
  robocopy $empty $path /MIR /NFL /NDL /NJH /NP | Out-Null
  Remove-Item -Recurse -Force $empty -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force $path -ErrorAction SilentlyContinue
}

# ── 0. Prerequisites ─────────────────────────────────────────────
Step "Checking prerequisites"
$nodeExe = Need node
Need pnpm | Out-Null
Need cargo | Out-Null
$ollamaExe = (Get-Command ollama -ErrorAction SilentlyContinue).Source
if (-not $ollamaExe) {
  $cand = Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"
  if (Test-Path $cand) { $ollamaExe = $cand }
}
if (-not $ollamaExe) { throw "ollama.exe not found. Install Ollama and pull your model first." }
if (-not $Update -and -not (Test-Path $ModelsPath)) { throw "Ollama models dir not found: $ModelsPath" }
Write-Host "node:   $nodeExe"
Write-Host "ollama: $ollamaExe"
if ($Update) {
  Write-Host "mode:   UPDATE artifact (no model bundled)" -ForegroundColor Yellow
  if (-not $env:TAURI_SIGNING_PRIVATE_KEY) {
    Write-Warning "TAURI_SIGNING_PRIVATE_KEY not set — the .sig updater artifact will NOT be produced and auto-update will reject this build."
  }
} else {
  Write-Host "models: $ModelsPath"
}

# ── 1. Clean & recreate staging dirs ─────────────────────────────
Step "Preparing resources staging"
Remove-DirRobust $resDir
New-Item -ItemType Directory -Force -Path (Join-Path $resDir "agent") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $resDir "ollama") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $resDir "ocr") | Out-Null

# ── 2. Bundle the Node agent ─────────────────────────────────────
Step "Building agent runtime (esbuild)"
Push-Location $root
pnpm install --frozen-lockfile=false
pnpm --filter "@catdesk/agent-runtime" build      # esbuild → dist/index.js
Pop-Location

$agentSrc = Join-Path $root "packages\agent-runtime"
$agentOut = Join-Path $resDir "agent"

Step "Staging agent (dist + production node_modules + node.exe)"
# Real (dereferenced) production node_modules so the externals sql.js &
# playwright-core resolve at runtime.
$deployDir = Join-Path $env:TEMP "nd-agent-deploy"
if (Test-Path $deployDir) { Remove-Item -Recurse -Force $deployDir }
Push-Location $root
# pnpm v10+ refuses a non-injected workspace deploy unless --legacy is passed
# (this repo doesn't inject), so deploy with --legacy directly. A failing pnpm
# sets $LASTEXITCODE but does NOT throw, so check it explicitly. pnpm also refuses
# a non-empty target, so ensure the dir is clean first (a prior failed attempt may
# have left a partial tree).
if (Test-Path $deployDir) { Remove-Item -Recurse -Force $deployDir }
pnpm --filter "@catdesk/agent-runtime" deploy --prod --legacy $deployDir
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "pnpm deploy failed (exit $LASTEXITCODE)" }
Pop-Location

# Robocopy plutôt que Copy-Item : le node_modules déployé (pnpm --legacy ne
# filtre pas les devDependencies des packages workspace liés) contient des
# chemins qui dépassent la limite Windows de 260 caractères ; Copy-Item
# échoue dessus, robocopy les gère nativement. On exclut en plus eslint et
# typescript (devDependencies de @catdesk/shared-types) : morts au runtime
# (esbuild a déjà tout inliné dans dist/index.js) et ce sont eux qui
# produisent les chemins les plus profonds (règles ESLint imbriquées) —
# les exclure élimine le problème à la racine plutôt que de le déplacer vers
# l'outil suivant (ISCC a le même souci de longueur de chemin que Copy-Item).
robocopy (Join-Path $deployDir "node_modules") (Join-Path $agentOut "node_modules") /E /XD eslint typescript /NFL /NDL /NJH /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy node_modules failed (exit $LASTEXITCODE)" }
Copy-Item -Recurse -Force (Join-Path $agentSrc "dist") (Join-Path $agentOut "dist")
Copy-Item -Force (Join-Path $agentSrc "package.json") (Join-Path $agentOut "package.json")
Copy-Item -Force $nodeExe (Join-Path $agentOut "node.exe")
# Skills livrés avec l'app. Doivent atterrir en SŒUR de dist/ : le runtime les
# cherche en `join(__dirname, '..', 'skills')`, ce qui donne dist/../skills ici
# et src/../skills en dev — même expression, aucun cas particulier. Les skills
# de l'utilisateur (<dataDir>/skills) priment à nom égal, donc une mise à jour
# n'écrase jamais une personnalisation.
$skillsSrc = Join-Path $agentSrc "skills"
if (Test-Path $skillsSrc) {
  Copy-Item -Recurse -Force $skillsSrc (Join-Path $agentOut "skills")
  $skillCount = (Get-ChildItem $skillsSrc -Filter *.md).Count
  Write-Host "Skills staged → $skillCount fichier(s)"
}
Write-Host "Agent staged → $agentOut"

# ── 3. Ollama binary (+ models, full build only) ─────────────────
Step "Staging Ollama runtime"
Copy-Item -Force $ollamaExe (Join-Path $resDir "ollama\ollama.exe")
# DLLs that sit DIRECTLY next to ollama.exe (base runtime). NOT recursive: the
# GPU backend DLLs (cuda_v*, rocm_v*) live under lib/ and are copied below with
# their structure. A recursive flatten would also dump them at the root, copying
# every multi-hundred-MB backend twice (~2.7 GB of pure duplication).
$ollamaSrcDir = Split-Path -Parent $ollamaExe
Get-ChildItem -Path (Join-Path $ollamaSrcDir '*.dll') -File -ErrorAction SilentlyContinue |
  ForEach-Object { Copy-Item -Force $_.FullName (Join-Path $resDir "ollama\$($_.Name)") }
$libDir = Join-Path $ollamaSrcDir "lib"
if (Test-Path $libDir) { Copy-Item -Recurse -Force $libDir (Join-Path $resDir "ollama\lib") }

if ($Update) {
  Write-Host "Skipping model copy (update artifact) — users keep their seeded model." -ForegroundColor Yellow
} else {
  Step "Staging Ollama models (this copies several GB)"
  Copy-Item -Recurse -Force $ModelsPath (Join-Path $resDir "ollama\models")
}
Write-Host "Ollama staged → $(Join-Path $resDir 'ollama')"

# ── 4. Python OCR sidecar (PyInstaller) ──────────────────────────
if ($SkipOcr) {
  Step "Skipping OCR sidecar (-SkipOcr)"
  # Leave the ocr/ dir empty; the agent degrades gracefully when the bundled
  # exe is absent (OCR_SIDECAR_BIN env is simply not set by Rust).
} else {
  Step "Building OCR sidecar (PyInstaller)"
  $ocrSrc = Join-Path $root "packages\ocr-vision"
  $venvPy = Join-Path $ocrSrc ".venv\Scripts\python.exe"
  if (-not (Test-Path $venvPy)) { throw "OCR venv missing: $venvPy (run scripts/setup.ps1 or use -SkipOcr)" }

  Push-Location $ocrSrc
  & $venvPy -m pip install --quiet pyinstaller
  # One-folder build is more reliable than --onefile for native deps
  # (opencv, faster-whisper, pywin32).
  & $venvPy -m PyInstaller --noconfirm --clean --onedir --name ocr-sidecar `
    --distpath (Join-Path $ocrSrc "build-dist") `
    --workpath (Join-Path $ocrSrc "build-work") `
    main.py
  Pop-Location

  $pyOut = Join-Path $ocrSrc "build-dist\ocr-sidecar"
  if (-not (Test-Path (Join-Path $pyOut "ocr-sidecar.exe"))) { throw "PyInstaller did not produce ocr-sidecar.exe" }
  Copy-Item -Recurse -Force "$pyOut\*" (Join-Path $resDir "ocr")

  # Tesseract language data (eng+fra+osd). Rust points TESSDATA_PREFIX here.
  $tessSrc = Join-Path $env:LOCALAPPDATA "nd-tessdata"
  if (Test-Path $tessSrc) {
    Copy-Item -Recurse -Force $tessSrc (Join-Path $resDir "ocr\tessdata")
  } else {
    Write-Warning "tessdata not found at $tessSrc — OCR text recognition will fail without it."
  }
  Write-Host "OCR staged → $(Join-Path $resDir 'ocr')"
}

# ── 5. Build the app (no bundling) ───────────────────────────────
# NSIS (Tauri's Windows bundler) caps near 2 GB and cannot package CatDesk's GPU
# runtime + multi-GB models, so build the exe WITHOUT bundling and package it
# with Inno Setup below (no size limit; disk-spanned for the >4 GB payload).
Step "Building Windows app (tauri build --no-bundle)"
Push-Location (Join-Path $root "apps\desktop")
pnpm exec tauri build --config $releaseConf --no-bundle
$tauriExit = $LASTEXITCODE
Pop-Location
if ($tauriExit -ne 0) { throw "tauri build failed (exit $tauriExit)" }

# ── 6. Package the offline installer (Inno Setup) ────────────────
Step "Packaging offline installer (Inno Setup)"
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "build-inno.ps1")
if ($LASTEXITCODE -ne 0) { throw "Inno packaging failed (exit $LASTEXITCODE)" }

Step "Done"
