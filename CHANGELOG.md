# Changelog

All notable changes to Forge will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

### Added
- MCP server (`forge-mcp`) exposing 23 tools for Claude Code integration
- Web UI (Vite + vanilla TS) served at `http://localhost:3131`
- Workflow detail page with step timeline, log viewer, and retry controls
- Approvals inbox — human gate for budget overrides and agent hiring
- Budget tracking and enforcement per agent and company-wide
- Live log streaming via `forge logs` and `forge logs --agent <slug>`
- `forge doctor` command for diagnosing setup issues
- `forge workflow watch` — real-time pipeline progress in terminal
- Heartbeat cron scheduler for scheduled agent execution
- Support for 10 AI runner providers: `claude-cli`, `anthropic-api`, `openrouter`, `gemini-cli`, `gemini-api`, `codex-cli`, `opencode-cli`, `ollama`, `http`, `process`
- Agent prompt and output contract layer (`ai-system/`)
- Per-step artifact storage in `IssueWorkProduct` table

### Changed
- Promoted canonical implementation to repository root (no more `v3/` subfolder)
- Renamed internal author from "The Firm" to "Forge Contributors"

---

## Initial public release

This is the first public release of Forge. The implementation was developed privately and is now being opened to the community.
