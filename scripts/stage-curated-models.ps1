<#
.SYNOPSIS
  Build a curated copy of the Ollama models dir containing only the CatDesk
  bundled lineup, so the offline installer ships exactly those models.

.DESCRIPTION
  The release build copies an entire models dir wholesale, including every blob.
  To drop a model from the bundle WITHOUT touching the developer's real ~/.ollama
  (re-pulling is painful on a slow link), this stages a fresh dir holding only the
  kept models' manifests plus the blobs they reference (no orphan weights).

  Prints the staging path on the last line for the caller to pass as -ModelsPath.
#>
[CmdletBinding()]
param(
  [string]$Source = (Join-Path $env:USERPROFILE ".ollama\models"),
  [string]$Stage  = (Join-Path $env:LOCALAPPDATA "catdesk-build-models")
)
$ErrorActionPreference = 'Stop'

# Relative manifest paths (under manifests/registry.ollama.ai/library) to KEEP.
$keep = @(
  "qwen2.5\7b",            # plancher général (français cohérent ; remplace le 3b)
  "qwen2.5-coder\14b",     # code specialist
  "qwen3\14b",             # powerful general (4070 Super)
  "nomic-embed-text\latest" # embeddings
)
$libRel = "manifests\registry.ollama.ai\library"

if (Test-Path $Stage) { Remove-Item -Recurse -Force $Stage }
New-Item -ItemType Directory -Force (Join-Path $Stage "blobs") | Out-Null

$blobs = New-Object System.Collections.Generic.HashSet[string]
foreach ($rel in $keep) {
  $mf = Join-Path $Source (Join-Path $libRel $rel)
  if (-not (Test-Path $mf)) { throw "Manifest manquant: $rel" }
  $dst = Join-Path $Stage (Join-Path $libRel $rel)
  New-Item -ItemType Directory -Force (Split-Path $dst) | Out-Null
  Copy-Item -Force $mf $dst
  $json = Get-Content $mf -Raw | ConvertFrom-Json
  [void]$blobs.Add($json.config.digest)
  foreach ($l in $json.layers) { [void]$blobs.Add($l.digest) }
  Write-Host "kept  $rel  ($($json.layers.Count) layers)"
}

foreach ($d in $blobs) {
  $fname = $d -replace ':', '-'           # sha256:xxx -> sha256-xxx
  $b = Join-Path $Source "blobs\$fname"
  if (-not (Test-Path $b)) { throw "Blob manquant: $fname" }
  Copy-Item -Force $b (Join-Path $Stage "blobs\$fname")
}

$sz = (Get-ChildItem -Recurse -File $Stage | Measure-Object -Property Length -Sum).Sum
Write-Host ("staged {0} blobs, {1:N1} GB" -f $blobs.Count, ($sz / 1GB))
Write-Output $Stage
