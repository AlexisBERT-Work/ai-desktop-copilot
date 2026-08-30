#!/usr/bin/env pwsh
# Start development environment
# Usage: .\scripts\dev.ps1

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

Write-Host "🚀 Starting CatDesk dev environment..." -ForegroundColor Cyan

# Check Ollama. `Start-Process` failing here must not be swallowed: without a
# live Ollama, `pnpm dev` starts anyway and every chat request fails silently.
try {
    Invoke-WebRequest -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 2 -ErrorAction Stop | Out-Null
    Write-Host "  ✅ Ollama running" -ForegroundColor Green
} catch {
    Write-Host "  ⚠️  Ollama not detected. Starting..." -ForegroundColor Yellow
    try {
        Start-Process "ollama" -ArgumentList "serve" -WindowStyle Hidden
    } catch {
        throw "Impossible de démarrer Ollama (est-il installé ? https://ollama.com). CatDesk ne peut pas fonctionner sans."
    }
    Start-Sleep 2
}

# Start turbo dev
pnpm dev
