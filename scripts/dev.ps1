#!/usr/bin/env pwsh
# Start development environment
# Usage: .\scripts\dev.ps1

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

Write-Host "🚀 Starting NeuroDesk dev environment..." -ForegroundColor Cyan

# Check Ollama
try {
    Invoke-WebRequest -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 2 -ErrorAction Stop | Out-Null
    Write-Host "  ✅ Ollama running" -ForegroundColor Green
} catch {
    Write-Host "  ⚠️  Ollama not detected. Starting..." -ForegroundColor Yellow
    Start-Process "ollama" -ArgumentList "serve" -WindowStyle Hidden
    Start-Sleep 2
}

# Start turbo dev
pnpm dev
