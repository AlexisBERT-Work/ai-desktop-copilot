<#
.SYNOPSIS
  Publish a CatDesk auto-update to GitHub Releases.

.DESCRIPTION
  One command to ship a code update to everyone who installed CatDesk:
    1. checks that the repo already carries -Version (set by bump-version.ps1),
    2. builds a lightweight signed UPDATE artifact (no model — see build-release.ps1 -Update),
    3. assembles the Tauri `latest.json` manifest,
    4. creates a GitHub Release and uploads the installer + latest.json.

  Installed apps check `releases/latest/download/latest.json` on launch and
  self-update silently (core/updater.rs).

  TWO RELEASE LINES coexist (docs/DISTRIBUTION.md § 0 bis) and must never cross:
    0.1.x  no voice, FROZEN  -> repo catdesk-releases        (git tag v0.1.3)
    0.2.x  voice             -> repo catdesk-releases-voice  (master, tags v0.2.x)
  The updater endpoint baked into each build (tauri.release.conf.json) says
  which repo its users poll. This script publishes THERE and refuses anything
  else: a 0.2.x build pushed to catdesk-releases as "latest" would silently
  upgrade every 0.1.x install.

.PARAMETER Version
  New semantic version, e.g. 0.2.1. MUST be greater than the installed one or
  clients won't update. The repo must already be at this version: run
  scripts/bump-version.ps1 and commit first (docs/DISTRIBUTION.md § 4).

.PARAMETER Notes
  Release notes shown on GitHub (optional).

.PARAMETER Repo
  GitHub repo receiving the release. Defaults to the repo of the updater
  endpoint in tauri.release.conf.json; passing a different one is an error.

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
  pwsh -File scripts/publish-update.ps1 -Version 0.2.1 -Notes "Nouveau: outil X"
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Version,
  [string]$Notes = "",
  # Resolved from the updater endpoint below when omitted (see .PARAMETER Repo).
  [string]$Repo = ""
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$tauriDir = Join-Path $root "apps\desktop\src-tauri"
$confPath = Join-Path $tauriDir "tauri.conf.json"
$releaseConfPath = Join-Path $tauriDir "tauri.release.conf.json"

# The Rust target dir is often relocated (CARGO_TARGET_DIR, passed through by
# turbo.json) to keep paths short on Windows — probe the same candidates as
# build-inno.ps1 instead of hardcoding the in-tree path. Resolved AFTER the
# build, since the directory may not exist yet.
function Resolve-NsisDir {
  $candidates = @(
    $(if ($env:CARGO_TARGET_DIR) { Join-Path $env:CARGO_TARGET_DIR "release\bundle\nsis" }),
    "$env:LOCALAPPDATA\nd-target\release\bundle\nsis",
    (Join-Path $tauriDir "target\release\bundle\nsis")
  ) | Where-Object { $_ }
  $found = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $found) {
    throw "NSIS output dir not found. Looked in:`n  $($candidates -join "`n  ")"
  }
  return $found
}

function Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }

# ── Prerequisites ────────────────────────────────────────────────
Step "Checking prerequisites"
if (-not $env:TAURI_SIGNING_PRIVATE_KEY) {
  throw "TAURI_SIGNING_PRIVATE_KEY is not set. See the .PREREQUISITES section of this script."
}
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw "gh CLI not found." }

# ── 1. The commit being shipped must already carry this version ──
# bump-version.ps1 writes it in the 9 places it lives. Bumping here instead (as
# this script used to) left 8 of them stale and shipped a binary that matched
# no commit. Checked before anything touches the network or the disk.
$confText = Get-Content $confPath -Raw
if (-not ($confText -match '"version"\s*:\s*"([^"]*)"')) { throw 'No "version" field in tauri.conf.json' }
$repoVersion = $Matches[1]
if ($repoVersion -ne $Version) {
  throw ("The repo is at $repoVersion, not $Version. First run`n" +
    "  powershell -File scripts/bump-version.ps1 -Version $Version`n" +
    "then add the CHANGELOG entry, commit, and run this script again.")
}
if (& git -C $root status --porcelain) {
  Write-Warning "Uncommitted changes: the published build will not match any commit."
}

# ── Which release line? The endpoint baked into the build decides ─
$endpoint = (Get-Content $releaseConfPath -Raw | ConvertFrom-Json).plugins.updater.endpoints[0]
if (-not ($endpoint -match '^https://github\.com/([^/]+/[^/]+)/releases/latest/download/latest\.json$')) {
  throw "Unexpected updater endpoint in tauri.release.conf.json: $endpoint"
}
$endpointRepo = $Matches[1]
if (-not $Repo) {
  $Repo = $endpointRepo
} elseif ($Repo -ne $endpointRepo) {
  throw ("-Repo '$Repo' does not match the updater endpoint repo '$endpointRepo' " +
    "(tauri.release.conf.json). Installed apps of this line poll '$endpointRepo': publishing " +
    "elsewhere is invisible to them, or upgrades the users of ANOTHER line. Change the endpoint instead.")
}
$repo = $Repo
# Confirm the release repo exists / is reachable before doing the heavy build.
& gh repo view $repo --json nameWithOwner | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Release repo '$repo' not reachable via gh (does it exist? are you authed?)." }
Write-Host "release repo: $repo   version: $Version"

# ── 2. Build the signed update artifact ──────────────────────────
Step "Building update artifact"
& (Join-Path $PSScriptRoot "build-release.ps1") -Update

# ── 3. Locate installer + signature ──────────────────────────────
# build-release.ps1 -Update builds with `--bundles nsis` precisely so this step
# has an installer AND a .sig to collect.
Step "Collecting artifacts"
$nsisDir = Resolve-NsisDir
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
Write-Host "Tag the shipped commit in the source repo:" -ForegroundColor Yellow
Write-Host "  git tag $tag; git push origin $tag" -ForegroundColor Yellow
