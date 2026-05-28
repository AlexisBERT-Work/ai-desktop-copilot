#!/usr/bin/env pwsh
# NeuroDesk — Full Windows Dev Environment Setup
# Run: .\scripts\setup.ps1

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot

Write-Host ""
Write-Host "╔══════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║   NeuroDesk — Dev Environment Setup          ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

Set-Location $projectRoot

# ─── Check prerequisites ──────────────────────────────────────
Write-Host "① Checking prerequisites..." -ForegroundColor Yellow

$checks = @(
    @{ Name = "Node.js ≥20"; Cmd = { node --version }; MinVersion = "v20" },
    @{ Name = "pnpm ≥9";     Cmd = { pnpm --version }; MinVersion = "9" },
    @{ Name = "Rust/cargo";  Cmd = { cargo --version }; Optional = $true },
    @{ Name = "Python ≥3.11"; Cmd = { python --version }; MinVersion = "3.11" },
    @{ Name = "Git";         Cmd = { git --version } }
)

$allOk = $true
foreach ($check in $checks) {
    try {
        $version = & $check.Cmd 2>&1 | Select-Object -First 1
        Write-Host "   ✅ $($check.Name): $version" -ForegroundColor Green
    } catch {
        if ($check.Optional) {
            Write-Host "   ⚠️  $($check.Name): not found (optional)" -ForegroundColor Yellow
        } else {
            Write-Host "   ❌ $($check.Name): NOT FOUND" -ForegroundColor Red
            $allOk = $false
        }
    }
}

if (-not $allOk) {
    Write-Host ""
    Write-Host "❌ Missing required tools. Please install them and re-run." -ForegroundColor Red
    Write-Host "   Node.js: https://nodejs.org"
    Write-Host "   pnpm:    npm install -g pnpm"
    Write-Host "   Rust:    https://rustup.rs"
    Write-Host "   Python:  https://python.org"
    exit 1
}

# ─── Install Node.js dependencies ────────────────────────────
Write-Host ""
Write-Host "② Installing Node.js dependencies..." -ForegroundColor Yellow
pnpm install
Write-Host "   ✅ Node dependencies installed" -ForegroundColor Green

# ─── Python virtual environment ──────────────────────────────
Write-Host ""
Write-Host "③ Setting up Python sidecar..." -ForegroundColor Yellow
Set-Location "$projectRoot\packages\ocr-vision"

if (-not (Test-Path ".venv")) {
    python -m venv .venv
}

& ".\.venv\Scripts\python.exe" -m pip install --upgrade pip -q
& ".\.venv\Scripts\pip.exe" install -r requirements.txt -q

Write-Host "   ✅ Python environment ready" -ForegroundColor Green
Set-Location $projectRoot

# ─── Check Ollama ────────────────────────────────────────────
Write-Host ""
Write-Host "④ Checking Ollama..." -ForegroundColor Yellow

try {
    $ollamaVersion = ollama --version 2>&1
    Write-Host "   ✅ Ollama: $ollamaVersion" -ForegroundColor Green

    # Check if Ollama is running
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 3 -ErrorAction Stop
        Write-Host "   ✅ Ollama server: running" -ForegroundColor Green
    } catch {
        Write-Host "   ⚠️  Ollama not running. Start it with: ollama serve" -ForegroundColor Yellow
    }
} catch {
    Write-Host "   ⚠️  Ollama not found. Install from https://ollama.com" -ForegroundColor Yellow
}

# ─── Pull recommended models ─────────────────────────────────
Write-Host ""
Write-Host "⑤ Pull LLM models? (this may take a while)" -ForegroundColor Yellow
$pullModels = Read-Host "   Pull qwen2.5:7b + nomic-embed-text? [y/N]"
if ($pullModels -eq "y" -or $pullModels -eq "Y") {
    Write-Host "   Pulling qwen2.5:7b..."
    ollama pull qwen2.5:7b
    Write-Host "   Pulling nomic-embed-text..."
    ollama pull nomic-embed-text
    Write-Host "   ✅ Models ready" -ForegroundColor Green
}

# ─── Initialize data directories ─────────────────────────────
Write-Host ""
Write-Host "⑥ Creating data directories..." -ForegroundColor Yellow
$dataDirs = @(
    "$projectRoot\packages\agent-runtime\data",
    "$projectRoot\packages\agent-runtime\data\audit"
)
foreach ($dir in $dataDirs) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
}
Write-Host "   ✅ Data directories created" -ForegroundColor Green

# ─── Done ────────────────────────────────────────────────────
Write-Host ""
Write-Host "╔══════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║   ✅ Setup complete!                          ║" -ForegroundColor Green
Write-Host "╚══════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Make sure Ollama is running: ollama serve"
Write-Host "  2. Start dev:                   pnpm dev"
Write-Host "  3. Open overlay:                Ctrl+Space"
Write-Host ""
