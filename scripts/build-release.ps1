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
if (Test-Path $resDir) { Remove-Item -Recurse -Force $resDir }
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

Copy-Item -Recurse -Force (Join-Path $deployDir "node_modules") (Join-Path $agentOut "node_modules")
Copy-Item -Recurse -Force (Join-Path $agentSrc "dist") (Join-Path $agentOut "dist")
Copy-Item -Force (Join-Path $agentSrc "package.json") (Join-Path $agentOut "package.json")
Copy-Item -Force $nodeExe (Join-Path $agentOut "node.exe")
Write-Host "Agent staged → $agentOut"

# ── 3. Ollama binary (+ models, full build only) ─────────────────
Step "Staging Ollama runtime"
Copy-Item -Force $ollamaExe (Join-Path $resDir "ollama\ollama.exe")
# Bundle the Ollama runtime DLLs that sit next to ollama.exe (GPU/CPU libs).
$ollamaSrcDir = Split-Path -Parent $ollamaExe
Get-ChildItem -Path $ollamaSrcDir -Include *.dll -Recurse -ErrorAction SilentlyContinue |
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

# ── 5. Build the installer ───────────────────────────────────────
Step "Building Tauri NSIS installer (this is the long part)"
Push-Location (Join-Path $root "apps\desktop")
pnpm exec tauri build --config $releaseConf
$tauriExit = $LASTEXITCODE
Pop-Location
if ($tauriExit -ne 0) { throw "tauri build failed (exit $tauriExit)" }

Step "Done"
$bundleDir = Join-Path $tauriDir "target\release\bundle\nsis"
Write-Host "Installer(s) in: $bundleDir" -ForegroundColor Green
Get-ChildItem $bundleDir -Filter *.exe -ErrorAction SilentlyContinue |
  ForEach-Object { Write-Host ("  {0}  ({1:N0} MB)" -f $_.Name, ($_.Length/1MB)) }
