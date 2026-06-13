# Changelog

All notable changes to CatDesk will be documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
Versioning: [Semantic Versioning](https://semver.org/)

---

## [Unreleased]

### Added
- Initial project structure and monorepo setup
- Shared TypeScript types package (`@catdesk/shared-types`)
- Agent runtime scaffold with Ollama client and streaming
- Permission engine with risk-level gating
- Conversation store (SQLite)
- Vector store stub (LanceDB in Phase 2)
- Audit logger
- OCR/Vision Python sidecar scaffold
- PDF, DOCX, CSV file parsers
- CI/CD GitHub Actions workflows
- Full project documentation and README

### Architecture
- Tauri 2.x + React 19 + Rust + Node.js + Python stack
- Hexagonal/modular architecture
- JSON-RPC 2.0 IPC protocol
- ReAct agent loop with tool system
