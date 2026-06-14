# CLAUDE.md

## What Forge Is

Forge is a local-first, provider-agnostic orchestration runtime for software work — a conductor that sits *above* the coding CLIs you already use. You submit a feature, bug, refactor, or release request, and Forge runs it through a staged agent pipeline with tracking, retries, approvals, and artifacts, routing each stage to whatever backend you configure for that agent.

The differentiator is the multi-CLI execution core: each pipeline stage can run on a different backend — Claude Code, Gemini CLI, Codex CLI, opencode, Ollama, or a direct API. Forge stays the vendor-neutral brain (deterministic gates, persistent tracking, retries, budgets); the coding CLIs are interchangeable workers underneath it.

## Architecture Overview

- Runtime bootstrap: `forge start` runs DB migrations/seeding, starts queue worker(s), heartbeat scheduler, HTTP server, and (by default) the interactive TUI console.
- Orchestration core: `src/orchestrator/` builds pipeline plans and dispatches step runs with dependency-aware scheduling.
- Agent execution: `src/bridge/worker.ts` pulls queued jobs, resolves workspace context, runs the configured provider runner, and reports step results back to the dispatcher.
- Provider runners: `src/bridge/runners/` is the multi-CLI core. A factory (`factory.ts`) resolves a per-agent `modelProvider` to a runner behind the `AgentRunner` interface — `claude-cli`, `gemini-cli`, `codex-cli`, `opencode-cli`, `ollama`, `cursor`, plus direct API/HTTP runners (`anthropic-api`, `gemini-api`, `openrouter`, `http`).
- API surface: Fastify routes in `src/server/routes/` expose intake, workflow status, approvals, queue, budget, and related system endpoints under `/v1`.
- Storage: Prisma + SQLite persistence for projects, issues, pipeline runs/steps, artifacts, approvals, budgets, and logs.

## Primary Surfaces

- CLI (primary): `forge run "..."` for submission, `forge start` to boot the runtime and open the TUI console.
- MCP server (optional integration surface): `forge-mcp` / `npm run mcp` — exposes the runtime to MCP clients like Claude Code.

The standalone OpenCode config generator and the web dashboard were removed in the conductor consolidation; the CLI is the single primary surface and the `/v1` HTTP API backs it.

## How to Run

```bash
forge init
forge start
forge run "add login screen" --type feature --mode fast
```

`forge run` is the primary submission command in V2.3+.
`forge feature create ...` and `forge bug create ...` remain supported compatibility commands.

## Pipeline Modes

### Fast Mode (default)

Fast mode runs the standard issue pipeline:

- feature: `intake-gate -> architect -> builder -> quality-guard -> devops -> retrospective-analyst`
- bug: `intake-gate -> architect -> builder -> quality-guard -> devops`
- refactor: `intake-gate -> architect -> builder -> quality-guard -> devops`
- release: `intake-gate -> architect -> builder -> quality-guard -> devops -> retrospective-analyst`

Key behavior:

- Each step receives transitive completed upstream outputs as appended context (classic pipeline context propagation).
- Context injection is bounded (`4000` chars per upstream stage, `12000` total cap).
- `quality-guard` can reject and loop back to `builder` with revision feedback (`maxRevisions: 2` on official fast pipelines).

### Structured Mode

Structured mode routes feature/bug/refactor/release requests into the harness pipeline:

- `planner`
- `sprint-1-contract -> sprint-1-contract-review -> sprint-1-build -> sprint-1-evaluate`
- Sprints `2..N` are appended dynamically from `planner` output.

Structured runs use typed artifacts (for example `ProductSpec`, `SprintContract`, `BuildResult`, `EvaluationReport`) and include explicit sprint decision points and approval-aware progression.

## Development Commands

```bash
# Runtime
forge init
forge start
forge start --headless
forge run "fix crash" --type bug --mode fast

# Build / test / lint
npm run build
npm run test
npm run lint

# Local development
npm run dev
npm run mcp

# Database
npm run db:migrate
npm run db:generate
npm run db:push
```

## Directory Structure

- `bin/` — CLI entrypoints (`forge`, `forge-mcp`)
- `src/cli/` — command implementations and TUI console shell
- `src/orchestrator/` — intake service, dispatcher, pipeline builders, harness artifact handling
- `src/bridge/` — worker loop, queue integration, workspace/session helpers
- `src/bridge/runners/` — multi-CLI provider runners + `factory.ts` (the conductor's execution core)
- `src/server/` — Fastify server and `/v1` route handlers
- `src/mcp/` — MCP server implementation for Claude Code integration
- `src/agents/` — agent registry/loading/validation logic
- `src/db/` + `prisma/` — DB client, migration/seeding glue, and Prisma schema/migrations
- `ai-system/official/agents/` — official prompt files used by pipeline agents
- `scripts/` — utility scripts (for example seeding helpers)

## For Claude Code (MCP Integration)

This section is MCP-specific. It is not Forge's overall identity.

When Claude is connected to Forge via MCP, it should behave as an orchestration assistant:

1. Clarify request intent and desired work type (`feature`, `bug`, `refactor`, `release`) and mode (`fast` or `structured`) if needed.
2. Submit approved work via `forge_submit_request` (preferred primary MCP entrypoint).
3. Track progress via `forge_get_pipeline`, `forge_wait_pipeline`, and `forge_list_pipeline_steps`.
4. Report status/results and use retry/cancel tools when needed.
5. Use `forge_run_agent_direct` only for explicit direct specialist requests.

### MCP Tool Surface

- Agents: `forge_list_agents`, `forge_get_agent`, `forge_hire_agent`, `forge_update_agent`, `forge_fire_agent`
- Intake & pipeline: `forge_submit_request`, `forge_run_agent_direct`, `forge_get_pipeline`, `forge_wait_pipeline`, `forge_list_pipeline_steps`, `forge_retry_pipeline_step`, `forge_cancel_pipeline`
- Issues: `forge_list_issues`, `forge_get_issue`, `forge_create_issue`, `forge_update_issue`
- Sprints: `forge_list_sprints`, `forge_create_sprint`
- System status: `forge_get_status`, `forge_get_budget`, `forge_list_queue`, `forge_get_job`

Notes:

- `forge-mcp` resolves default `companyId`/`projectId` from backend context, so most calls do not need those IDs manually.
- MCP flow is intake-first; `forge_submit_request` is the preferred entrypoint for all work submission.
