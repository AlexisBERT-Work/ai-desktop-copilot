<#
.SYNOPSIS
  Package the already-built CatDesk exe + staged resources into a full offline
  Inno Setup installer.

.DESCRIPTION
  Tauri's NSIS bundler cannot handle CatDesk's size (GPU runtime + multi-GB
  models), so we build the Windows app without bundling (tauri build --no-bundle)
  and package it here with Inno Setup, which has no 2 GB limit.

  Expects, beforehand:
    - the release exe built (scripts/build-release.ps1 runs tauri build --no-bundle), and
    - resources staged under apps/desktop/src-tauri/resources/ (agent/ ollama/ ocr/).

.PARAMETER ExeDir
  Directory containing the built catdesk.exe. Auto-detected if omitted.
#>
[CmdletBinding()]
param([string]$ExeDir)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$resDir = Join-Path $root "apps\desktop\src-tauri\resources"
$iss = Join-Path $PSScriptRoot "catdesk.iss"
$outDir = Join-Path $root "dist-installer"

function Step($m) { Write-Host ("`n=== {0} ===" -f $m) -ForegroundColor Cyan }

# Locate ISCC (Inno Setup compiler)
$iscc = @(
  "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
  "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
  "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $iscc) { throw "ISCC.exe not found. Install Inno Setup 6 (winget install JRSoftware.InnoSetup)." }

# Locate the built exe
if (-not $ExeDir) {
  $ExeDir = @(
    "$env:LOCALAPPDATA\nd-target\release",
    (Join-Path $root "apps\desktop\src-tauri\target\release")
  ) | Where-Object { Test-Path (Join-Path $_ "catdesk.exe") } | Select-Object -First 1
}
if (-not $ExeDir -or -not (Test-Path (Join-Path $ExeDir "catdesk.exe"))) {
  throw "catdesk.exe not found. Run scripts/build-release.ps1 first (it builds the exe)."
}

# Sanity: resources staged
foreach ($d in 'agent','ollama','ocr') {
  if (-not (Test-Path (Join-Path $resDir $d))) { throw "Missing staged resource '$d'. Run build-release.ps1 staging first." }
}
$hasModels = Test-Path (Join-Path $resDir "ollama\models\manifests")
# Vrai seulement s'il y a AU MOINS un fichier réel (pas juste le dossier vide
# laissé par -SkipOcr) — sinon le Source wildcard de catdesk.iss ferait
# échouer ISCC ("No files found matching").
$hasOcr = [bool](Get-ChildItem (Join-Path $resDir "ocr") -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1)
Write-Host "ISCC:      $iscc"
Write-Host "exe dir:   $ExeDir"
Write-Host "resources: $resDir (models bundled: $hasModels, ocr bundled: $hasOcr)"

# Compile
Step "Building Inno Setup installer (large, may take a while)"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$isccArgs = @("/Qp", "/DExeDir=$ExeDir", "/DResDir=$resDir", "/DOutputDir=$outDir")
if ($hasOcr) { $isccArgs += "/DHasOcr=1" }
& $iscc @isccArgs $iss
if ($LASTEXITCODE -ne 0) { throw "ISCC failed (exit $LASTEXITCODE)" }

Step "Done"
Get-ChildItem $outDir -Filter *.exe -ErrorAction SilentlyContinue | ForEach-Object {
  Write-Host ("  {0}  ({1:N0} MB)" -f $_.Name, ($_.Length/1MB)) -ForegroundColor Green
}
