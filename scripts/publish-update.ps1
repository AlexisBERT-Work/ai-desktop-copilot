<#
.SYNOPSIS
  Publish a CatDesk auto-update to GitHub Releases.

.DESCRIPTION
  One command to ship a code update to everyone who installed CatDesk:
    1. bumps the version in tauri.conf.json,
    2. builds a lightweight signed UPDATE artifact (no model — see build-release.ps1 -Update),
    3. assembles the Tauri `latest.json` manifest,
    4. creates a GitHub Release and uploads the installer + latest.json.

  Installed apps check `releases/latest/download/latest.json` on launch and
  self-update silently (core/updater.rs).

.PARAMETER Version
  New semantic version, e.g. 0.1.1. MUST be greater than the installed one or
  clients won't update.

.PARAMETER Notes
  Release notes shown on GitHub (optional).

.PREREQUISITES
  - One-time: generate a signing key →  pnpm exec tauri signer generate -w "$HOME\.tauri\catdesk.key"
    then paste the PUBLIC key into apps/desktop/src-tauri/tauri.release.conf.json (plugins.updater.pubkey).
  - These env vars set in the current shell (the PRIVATE key + its password):
      $env:TAURI_SIGNING_PRIVATE_KEY          = Get-Content "$HOME\.tauri\catdesk.key" -Raw
      $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "<your key password>"
  - gh CLI authenticated (gh auth status).

.EXAMPLE
  $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content "$HOME\.tauri\catdesk.key" -Raw
  $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "secret"
  pwsh -File scripts/publish-update.ps1 -Version 0.1.1 -Notes "Nouveau: outil X"
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Version,
  [string]$Notes = "",
  # Releases are published to the dedicated CatDesk repo, not the dev repo this
  # source lives in. Override only if you move the release repo.
  [string]$Repo = "AlexisBERT-Work/CatDesk"
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$tauriDir = Join-Path $root "apps\desktop\src-tauri"
$confPath = Join-Path $tauriDir "tauri.conf.json"
$nsisDir = Join-Path $tauriDir "target\release\bundle\nsis"

function Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }

# ── Prerequisites ────────────────────────────────────────────────
Step "Checking prerequisites"
if (-not $env:TAURI_SIGNING_PRIVATE_KEY) {
  throw "TAURI_SIGNING_PRIVATE_KEY is not set. See the .PREREQUISITES section of this script."
}
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw "gh CLI not found." }
$repo = $Repo
# Confirm the release repo exists / is reachable before doing the heavy build.
& gh repo view $repo --json nameWithOwner | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Release repo '$repo' not reachable via gh (does it exist? are you authed?)." }
Write-Host "release repo: $repo   version: $Version"

# ── 1. Bump version in tauri.conf.json (surgical, preserves formatting) ──
Step "Bumping version → $Version"
$confText = Get-Content $confPath -Raw
$newText = [regex]::Replace($confText, '("version"\s*:\s*")[^"]*(")', "`${1}$Version`${2}", 1)
if ($newText -eq $confText) { throw 'Could not find a "version" field to bump in tauri.conf.json' }
Set-Content $confPath -Value $newText -Encoding utf8 -NoNewline
Write-Host "tauri.conf.json version set to $Version"

# ── 2. Build the signed update artifact ──────────────────────────
Step "Building update artifact"
& (Join-Path $PSScriptRoot "build-release.ps1") -Update

# ── 3. Locate installer + signature ──────────────────────────────
Step "Collecting artifacts"
$setup = Get-ChildItem $nsisDir -Filter "*-setup.exe" | Sort-Object LastWriteTime | Select-Object -Last 1
if (-not $setup) { throw "No -setup.exe found in $nsisDir" }
$sigFile = "$($setup.FullName).sig"
if (-not (Test-Path $sigFile)) {
  throw "Signature $sigFile missing. Did the signing env vars get picked up by tauri build?"
}
$signature = Get-Content $sigFile -Raw
$downloadUrl = "https://github.com/$repo/releases/download/v$Version/$($setup.Name)"
Write-Host "installer: $($setup.Name)  ($([math]::Round($setup.Length/1MB)) MB)"

# ── 4. Assemble latest.json (Tauri v2 updater manifest) ──────────
Step "Writing latest.json"
$manifest = [ordered]@{
  version   = $Version
  notes     = $Notes
  pub_date  = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  platforms = [ordered]@{
    "windows-x86_64" = [ordered]@{
      signature = $signature.Trim()
      url       = $downloadUrl
    }
  }
}
$latestPath = Join-Path $nsisDir "latest.json"
$manifest | ConvertTo-Json -Depth 10 | Set-Content $latestPath -Encoding utf8

# ── 5. Create the GitHub Release ─────────────────────────────────
Step "Publishing GitHub release v$Version"
$tag = "v$Version"
$relNotes = if ($Notes) { $Notes } else { "CatDesk $Version" }
& gh release create $tag $setup.FullName $latestPath `
  --repo $repo --title "CatDesk $Version" --notes $relNotes --latest

Step "Done"
Write-Host "Published $tag. Installed apps will self-update on next launch." -ForegroundColor Green
Write-Host "Don't forget to commit the version bump in tauri.conf.json." -ForegroundColor Yellow
