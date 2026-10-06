<#
.SYNOPSIS
  Set the CatDesk version everywhere it is written down, in one go.

.DESCRIPTION
  The version lives in 9 places that must agree: the four package.json files,
  tauri.conf.json, Cargo.toml and the catdesk entry of Cargo.lock, catdesk.iss,
  and catdesk-bootstrap.iss (three times: MyAppVersion, BaseName and the
  release tag inside BaseUrl).

  Each field is rewritten through a regex scoped to that single field, and the
  script stops before writing anything if a field is not found exactly once.
  No blanket search/replace (see the CLAUDE.md note on mass regex edits).
  Encoding (BOM or not) and line endings are preserved.

  It does not commit, tag nor publish. The release cycle is described in
  docs/DISTRIBUTION.md section 4.

.PARAMETER Version
  New version, X.Y.Z, strictly greater than the current one (read from
  tauri.conf.json).

.EXAMPLE
  powershell -File scripts/bump-version.ps1 -Version 0.2.1 -WhatIf
  powershell -File scripts/bump-version.ps1 -Version 0.2.1
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [Parameter(Mandatory = $true)][string]$Version
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

if ($Version -notmatch '^\d+\.\d+\.\d+$') {
  throw "Version '$Version' is not X.Y.Z (no 'v' prefix, no pre-release suffix)."
}

# The value always sits in the named group 'v'; only that span is replaced.
$v = '(?<v>\d+\.\d+\.\d+)'
$sites = @(
  @{ File = 'package.json';                            Field = 'version';      Pattern = '"version"\s*:\s*"' + $v + '"' },
  @{ File = 'apps/desktop/package.json';               Field = 'version';      Pattern = '"version"\s*:\s*"' + $v + '"' },
  @{ File = 'packages/agent-runtime/package.json';     Field = 'version';      Pattern = '"version"\s*:\s*"' + $v + '"' },
  @{ File = 'packages/shared-types/package.json';      Field = 'version';      Pattern = '"version"\s*:\s*"' + $v + '"' },
  @{ File = 'apps/desktop/src-tauri/tauri.conf.json';  Field = 'version';      Pattern = '"version"\s*:\s*"' + $v + '"' },
  @{ File = 'apps/desktop/src-tauri/Cargo.toml';       Field = '[package]';    Pattern = '(?m)^version\s*=\s*"' + $v + '"' },
  @{ File = 'apps/desktop/src-tauri/Cargo.lock';       Field = 'catdesk';      Pattern = 'name = "catdesk"\r?\nversion = "' + $v + '"' },
  @{ File = 'scripts/catdesk.iss';                     Field = 'MyAppVersion'; Pattern = '#define MyAppVersion "' + $v + '"' },
  @{ File = 'scripts/catdesk-bootstrap.iss';           Field = 'MyAppVersion'; Pattern = '#define MyAppVersion "' + $v + '"' },
  @{ File = 'scripts/catdesk-bootstrap.iss';           Field = 'BaseName';     Pattern = '#define BaseName "CatDesk-' + $v + '-offline-setup"' },
  @{ File = 'scripts/catdesk-bootstrap.iss';           Field = 'BaseUrl tag';  Pattern = '/releases/download/v' + $v + '"' }
)

# Strict UTF-8 decoding: a file that is not valid UTF-8 stops the script
# instead of being silently re-encoded.
$strictUtf8 = New-Object System.Text.UTF8Encoding($false, $true)

function Read-Text($path) {
  $bytes = [System.IO.File]::ReadAllBytes($path)
  $hasBom = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
  $offset = if ($hasBom) { 3 } else { 0 }
  return @{ Text = $strictUtf8.GetString($bytes, $offset, $bytes.Length - $offset); HasBom = $hasBom }
}

# -- Current version: tauri.conf.json is the reference ---------------
$confPath = Join-Path $root 'apps/desktop/src-tauri/tauri.conf.json'
$confMatch = [regex]::Match((Read-Text $confPath).Text, $sites[4].Pattern)
if (-not $confMatch.Success) { throw "No version field found in $confPath" }
$current = $confMatch.Groups['v'].Value
if ([version]$Version -le [version]$current) {
  throw "Version $Version is not greater than the current $current. Installed apps only move up."
}
Write-Host "Version: $current -> $Version"

# -- Pass 1: locate every field (nothing is written if one is missing) -
$files = [ordered]@{}
foreach ($site in $sites) {
  $path = Join-Path $root $site.File
  if (-not $files.Contains($site.File)) {
    $content = Read-Text $path
    $files[$site.File] = @{ Path = $path; Text = $content.Text; HasBom = $content.HasBom; Sites = @() }
  }
  $found = [regex]::Matches($files[$site.File].Text, $site.Pattern)
  if ($found.Count -ne 1) {
    throw "$($site.File) [$($site.Field)]: expected exactly 1 match, found $($found.Count). Nothing was written."
  }
  $files[$site.File].Sites += $site
}

# -- Pass 2: rewrite, one file at a time ---------------------------
foreach ($file in $files.Keys) {
  $entry = $files[$file]
  $text = $entry.Text
  $changes = @()
  foreach ($site in $entry.Sites) {
    $group = [regex]::Match($text, $site.Pattern).Groups['v']
    $old = $group.Value
    $note = if ($old -ne $current) { "  (was out of sync)" } else { "" }
    $changes += "  $($site.Field): $old -> $Version$note"
    $text = $text.Substring(0, $group.Index) + $Version + $text.Substring($group.Index + $group.Length)
  }
  if ($PSCmdlet.ShouldProcess($file, "set version to $Version")) {
    [System.IO.File]::WriteAllText($entry.Path, $text, (New-Object System.Text.UTF8Encoding($entry.HasBom)))
  }
  Write-Host $file
  $changes | ForEach-Object { Write-Host $_ }
}

if (-not $WhatIfPreference) {
  Write-Host ""
  Write-Host "Next: add the [$Version] entry to CHANGELOG.md, then" -ForegroundColor Yellow
  Write-Host "  git commit -am `"chore(release): $Version`"" -ForegroundColor Yellow
  Write-Host "Release cycle: docs/DISTRIBUTION.md section 4." -ForegroundColor Yellow
}
