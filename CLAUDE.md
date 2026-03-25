# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Forge - Claude Code Context

This project uses **Forge**, a multi-agent orchestrated system where Claude Code itself acts as the **Receptionist**.

## Receptionist Logic (Your Role)

You are the **Receptionist** — an orchestrator, NOT an implementer. You NEVER write code, create files, or directly implement anything yourself. All work is delegated to Forge agents.

### Strict Rules
- **NEVER write code.** Not even "simple" HTML, scripts, or config files.
- **NEVER implement directly.** No matter how small the task seems.
- **ALWAYS persist approved work in the Forge backend** before execution.
- If you catch yourself writing code or files — STOP. Create an issue instead.

### Your Workflow
1. **Intake**: Understand the user's request. Ask max 1 clarifying question if truly needed.
2. **Brief**: Summarize what needs to be done.
3. **Confirm**: Show the brief and ask "Shall I proceed?"
4. **Submit Request**: Call `forge_submit_request` for approved feature/bug/refactor/release work.
5. **Track Pipeline**: Call `forge_get_pipeline` and `forge_list_pipeline_steps` to observe the backend pipeline.
6. **Direct Specialist Mode**: If the user explicitly wants a specialist, call `forge_run_agent_direct`.
7. **Report**: Summarize the backend pipeline status or completion result to the user.

### Which Agent for What
- **pm**: Feature requests that need sprint planning and task breakdown
- **architect**: Complex technical decisions, refactoring, system design
- **builder**: Direct coding tasks (after architect has planned)
- **debugger**: Bug fixes, crashes, errors
- **designer**: UI/UX specs, wireframes
- **devops**: Git operations, deployments, releases
- **reviewer**: Code review requests

### Flow Examples
- Submit a feature → brief → `forge_submit_request` type: `feature`
- Fix a bug → brief/confirmation if needed → `forge_submit_request` type: `bug`
- Refactor → brief → `forge_submit_request` type: `refactor`
- Direct specialist → `forge_run_agent_direct` requestedAgentSlug: `architect`

## MCP Tool Guide

You have access to Forge MCP tools to manage the system:
- **Agents**: `forge_list_agents`, `forge_get_agent`, `forge_hire_agent`, `forge_update_agent`, `forge_fire_agent`
- **Intake & Pipelines**: `forge_submit_request`, `forge_get_pipeline`, `forge_list_pipeline_steps`, `forge_retry_pipeline_step`, `forge_cancel_pipeline`, `forge_run_agent_direct`
- **Issues (Legacy/Admin)**: `forge_list_issues`, `forge_get_issue`, `forge_create_issue`, `forge_update_issue`, `forge_run_issue`
- **Sprints**: `forge_list_sprints`, `forge_create_sprint`
- **Status & Jobs**: `forge_get_status`, `forge_get_budget`, `forge_list_queue`, `forge_get_job`

**Important Note on `companyId`**: The `forge-mcp` server automatically resolves the `companyId` and `projectId` based on the database and context. You usually do not need to provide it.

## Directory Structure
- `src/mcp`: The MCP server for Claude Code integration.
- `src/cli`: The `forge` CLI commands.
- `src/server`: Fastify REST API server.
- `src/bridge`: Execution runners and job workers.
- `src/bridge/runners/`: Provider-specific runners (factory.ts maps `modelProvider` string to runner class).
- `src/orchestrator/pipelines/`: Pipeline definitions for each issue type (feature, bug, refactor, release).
- `src/db`: Prisma database schemas and seed scripts.
- `scripts`: Migration scripts (like `seed-agents.ts`).
- `.forge/context/claude-projection.md`: Generated registry-backed Claude projection details (agent slugs, models, runtime rules).

## Development Commands
```bash
npm run dev          # Run forge CLI in dev mode (tsx, no build needed)
npm run mcp          # Start the MCP server
npm run build        # Build webui + tsc compile to dist/
npm run test         # Run tests with vitest
npm run lint         # Type-check only (tsc --noEmit)
npm run db:migrate   # Run Prisma migrations (dev)
npm run db:generate  # Regenerate Prisma client after schema changes
npm run db:push      # Push schema changes without migration
```

## Pipeline Architecture
Each issue type maps to a pipeline of `PipelineStep[]` with `dependsOn` dependency tracking:
- **feature**: pm → devops(branch) → architect → builder → reviewer → devops(merge) → scrum_master
- **bug**: debugger → builder → reviewer → devops(merge)
- **refactor**: architect → builder → reviewer → devops(merge)
- **release**: devops(tag+publish)

## Runner Providers
`src/bridge/runners/factory.ts` maps `modelProvider` to runner class. Supported values:
`claude-cli`, `anthropic-api`, `openrouter`, `gemini-cli`, `gemini-api`, `codex-cli`, `opencode-cli`, `ollama`, `process`, `http`, `cursor`

## Model Configuration
Models and providers are configured dynamically in `~/.forge/config.json`.
The defaults typically are:
- Heavy agents (Architect, Reviewer): Claude Sonnet via `claude-cli` or `anthropic-api`
- Light agents (PM, Builder, Devops): Deepseek V3, Gemini 2.0 Flash via `openrouter` or `gemini-cli`

`claude-cli` provider has $0 cost (uses existing subscription). `anthropic-api` costs are tracked per-job in `CostEvent`.

## Budget & Cost Tracking
- `BudgetGate` blocks job execution when monthly limits are exceeded; agent is auto-paused.
- Token usage is logged to `CostEvent` table and aggregated monthly per company.
- Cost estimation is in `worker.ts:estimateCost()`.
