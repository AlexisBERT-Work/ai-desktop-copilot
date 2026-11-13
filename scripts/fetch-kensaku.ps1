<#
.SYNOPSIS
  Installe le CLI Kensaku epingle, moteur de semantic_search dans CatDesk.

.DESCRIPTION
  CatDesk n'installe jamais Kensaku tout seul : c'est toi qui lances ce script.

    1. telecharge kensaku-cli-windows-x86_64.exe de la release epinglee
       (github.com/yjid/kensaku, licence MIT) ;
    2. verifie son SHA-256 contre la valeur ci-dessous, la meme que
       KENSAKU_PINNED dans packages/agent-runtime/src/search/kensakuBackend.ts
       (un test verifie qu'elles concordent) ;
    3. le pose dans %LOCALAPPDATA%\nd-kensaku\kensaku-cli.exe, ou l'agent le
       cherche (ou ailleurs, via la variable CATDESK_KENSAKU_CLI).

  Le CLI ne fait que LIRE l'index. L'index, c'est l'application Kensaku qui le
  construit : installe-la depuis la meme release, et choisis comme dossiers
  Documents, Bureau et Telechargements (la liste blanche de CatDesk). CatDesk
  ecarte de toute facon chaque resultat hors de sa liste blanche.

  Rien n'est installe si l'empreinte ne correspond pas.

.PARAMETER Dest
  Dossier de destination.

.EXAMPLE
  powershell -File scripts/fetch-kensaku.ps1
#>
[CmdletBinding()]
param(
  [string]$Dest = (Join-Path $env:LOCALAPPDATA 'nd-kensaku')
)

# Fichier en ASCII : PowerShell 5.1 lit un .ps1 sans BOM en cp1252.
$ErrorActionPreference = 'Stop'

$Version = '1.0.17'
$Sha256 = 'c82a306648fbe4fee541a0ff781a872d8b28f489a99a3c668cd73d686e4322e4'
$Asset = 'kensaku-cli-windows-x86_64.exe'
$Url = "https://github.com/yjid/kensaku/releases/download/v$Version/$Asset"

New-Item -ItemType Directory -Force -Path $Dest | Out-Null
$target = Join-Path $Dest 'kensaku-cli.exe'
$partial = Join-Path $Dest "$Asset.part"

Write-Host "fetch   kensaku-cli $Version"
# curl.exe (Windows 10+) : suit les redirections GitHub, echoue sur une erreur HTTP.
& curl.exe -sSfL -o $partial $Url
if ($LASTEXITCODE -ne 0) {
  if (Test-Path $partial) { Remove-Item -Force $partial }
  throw "telechargement echoue : $Url"
}

$actual = (Get-FileHash -Algorithm SHA256 -Path $partial).Hash.ToLowerInvariant()
if ($actual -ne $Sha256) {
  Remove-Item -Force $partial
  throw "empreinte inattendue : $actual (attendu $Sha256). Rien n'est installe."
}

Move-Item -Force $partial $target
Write-Host "ok      $target (SHA-256 verifie)"
Write-Host "ensuite installe l'application Kensaku $Version (meme release) et indexe"
Write-Host "        Documents, Bureau et Telechargements ; lance-la une fois."
