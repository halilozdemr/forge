# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| Latest  | Yes       |

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

If you discover a security vulnerability, open a [GitHub Security Advisory](https://github.com/halilozdemr/forge/security/advisories/new) on this repository. We will respond within 72 hours.

Include in your report:
- A description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested mitigations, if you have them

We will acknowledge your report, investigate, and work toward a fix. We ask that you do not disclose the issue publicly until a fix has been released.

## Scope

Areas of particular concern:
- **`~/.forge/config.json`** — stores API keys and project paths. Forge never transmits this file. Keep it out of version control (it is gitignored by default).
- **`~/.forge/forge.db`** — SQLite database containing all pipeline runs and artifacts. This file should not be committed or shared.
- **MCP server** — `forge-mcp` runs locally and exposes tools to Claude Code. It binds only to localhost.
- **AI runner providers** — API keys for Anthropic, OpenRouter, etc. are read from config at runtime and never logged.
