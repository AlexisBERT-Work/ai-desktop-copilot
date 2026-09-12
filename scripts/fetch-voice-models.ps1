<#
.SYNOPSIS
  Télécharge les modèles de la voix (mode « Jarvis ») dans un cache local.

.DESCRIPTION
  Quatre modèles, tous CPU, servis par les releases GitHub de sherpa-onnx :

    silero_vad.onnx                                   VAD Silero          ~0,6 Mo
    sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/       STT Parakeet v3    ~640 Mo
    vits-piper-fr_FR-miro-high/                       TTS Piper (défaut)  ~78 Mo
    vits-piper-fr_FR-siwis-medium/                    TTS Piper (alt.)    ~78 Mo

  Destination par défaut : %LOCALAPPDATA%\nd-voice-models (même convention que
  nd-tessdata). L'app en dev la trouve directement ; build-release.ps1 la copie
  dans resources\voice. Un modèle déjà présent n'est pas retéléchargé.

.PARAMETER Dest
  Dossier de destination.

.EXAMPLE
  pwsh -File scripts/fetch-voice-models.ps1
#>
[CmdletBinding()]
param(
  [string]$Dest = (Join-Path $env:LOCALAPPDATA "nd-voice-models")
)

# Chaines affichees sans accents : PowerShell 5.1 lit ce fichier en ANSI et la
# console est en cp1252 (cf. CLAUDE.md).
$ErrorActionPreference = 'Stop'
$base = 'https://github.com/k2-fsa/sherpa-onnx/releases/download'

New-Item -ItemType Directory -Force -Path $Dest | Out-Null

# (nom du dossier/fichier attendu, URL, fichier témoin de complétude)
$models = @(
  @{ Name = 'silero_vad.onnx'; Url = "$base/asr-models/silero_vad.onnx"; Probe = 'silero_vad.onnx' },
  @{ Name = 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8'; Url = "$base/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2"; Probe = 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8\tokens.txt' },
  @{ Name = 'vits-piper-fr_FR-miro-high'; Url = "$base/tts-models/vits-piper-fr_FR-miro-high.tar.bz2"; Probe = 'vits-piper-fr_FR-miro-high\tokens.txt' },
  @{ Name = 'vits-piper-fr_FR-siwis-medium'; Url = "$base/tts-models/vits-piper-fr_FR-siwis-medium.tar.bz2"; Probe = 'vits-piper-fr_FR-siwis-medium\tokens.txt' }
)

foreach ($m in $models) {
  $probe = Join-Path $Dest $m.Probe
  if (Test-Path $probe) {
    Write-Host "ok      $($m.Name) (deja present)"
    continue
  }
  Write-Host "fetch   $($m.Name)"
  if ($m.Url.EndsWith('.tar.bz2')) {
    $archive = Join-Path $Dest "$($m.Name).tar.bz2"
    # curl.exe (Windows 10+) : reprise (-C -) et redirections GitHub.
    & curl.exe -sL -C - -o $archive $m.Url
    if ($LASTEXITCODE -ne 0) { throw "telechargement echoue : $($m.Url)" }
    # tar.exe (bsdtar, Windows 10+) lit le bz2 nativement.
    & tar.exe -xjf $archive -C $Dest
    if ($LASTEXITCODE -ne 0) { throw "extraction echouee : $archive" }
    Remove-Item -Force $archive
    # Les `test_wavs` de Parakeet (quelques centaines de Ko) restent : les tests
    # de fumée Rust (`cargo test -- --ignored voice::smoke`) lisent `fr.wav`.
  } else {
    & curl.exe -sL -o (Join-Path $Dest $m.Name) $m.Url
    if ($LASTEXITCODE -ne 0) { throw "telechargement echoue : $($m.Url)" }
  }
  if (-not (Test-Path $probe)) { throw "modele incomplet apres extraction : $($m.Name)" }
}

$size = (Get-ChildItem $Dest -Recurse -File | Measure-Object -Property Length -Sum).Sum / 1MB
Write-Host ("Modeles voix prets dans {0} ({1:N0} Mo)" -f $Dest, $size)
