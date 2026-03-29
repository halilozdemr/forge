# Architecture

## Component overview

| Component | Path | What it does |
|---|---|---|
| **CLI** | `src/cli/` | All `forge` commands. Each command is one file under `commands/`. |
| **Console / TUI** | `src/cli/console/` | Interactive terminal UI. See [console.md](console.md). |
| **Server** | `src/server/` | Fastify REST API on `localhost:3131`. All CLI and Web UI requests go through here. |
| **Worker** | `src/bridge/worker.ts` | Job processor. Picks up queued jobs, spawns the AI runner, streams output, writes logs and artifacts to SQLite. |
| **Queue** | `src/bridge/queue.ts` | In-process SQLite-backed job queue. No Redis required. |
| **Runner Factory** | `src/bridge/runners/` | Maps `modelProvider` string to a provider-specific runner class. |
| **Dispatcher** | `src/orchestrator/dispatcher.ts` | Pipeline state machine. Resolves `dependsOn`, advances steps, injects harness sprints dynamically. |
| **Pipelines** | `src/orchestrator/pipelines/` | Pipeline definitions for feature, bug, refactor, release, and harness. |
| **Agents** | `src/agents/` | Agent registry, loader, and defaults. Seeded on `forge start`, configurable live. |
| **Heartbeat** | `src/heartbeat/` | Cron-based scheduler for agents with `heartbeatCron` configured. |
| **Database** | `src/db/` | Prisma + SQLite at `~/.forge/forge.db`. All state lives here. |
| **MCP Server** | `src/mcp/` | `forge-mcp` binary — exposes tools so Claude Code can orchestrate Forge. |
| **Web UI** | `webui/` | Vite + vanilla TS SPA served at `http://localhost:3131`. |

---

## Repository structure

```
.
├── src/
│   ├── cli/
│   │   ├── commands/         # One file per CLI command
│   │   ├── console/          # Interactive TUI shell and views
│   │   │   ├── shell.ts      # Main TUI event loop
│   │   │   ├── layout.ts     # ANSI-aware layout engine
│   │   │   ├── keymap.ts     # Keybinding definitions
│   │   │   └── views/        # One file per screen
│   │   └── execution-mode.ts # fast / structured resolution
│   ├── server/
│   │   └── routes/           # One file per route group
│   ├── bridge/
│   │   ├── worker.ts         # Main job processor
│   │   ├── queue.ts          # SQLite job queue setup
│   │   └── runners/          # Provider-specific runner classes
│   ├── orchestrator/
│   │   ├── dispatcher.ts     # Pipeline state machine
│   │   ├── artifacts.ts      # Artifact types and storage
│   │   ├── harness-artifacts.ts
│   │   └── pipelines/        # feature.ts, bug.ts, refactor.ts, release.ts, harness.ts
│   ├── agents/               # Agent registry, loader, defaults
│   ├── db/                   # Prisma client, migrations, seed
│   ├── mcp/                  # MCP server
│   ├── heartbeat/            # Heartbeat scheduler
│   └── utils/                # Config, logger, crypto, process helpers
├── webui/                    # Vite + vanilla TS web interface
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── ai-system/
│   ├── official/agents/      # Agent prompts (intake-gate, architect, harness-builder, evaluator, …)
│   ├── official/projections/ # Capability profiles
│   └── contracts/            # Output contract JSON schemas
└── .forge/                   # Runtime data — gitignored
    ├── config.json
    └── forge.db
```

---

## MCP tools

`forge-mcp` exposes 23 tools to Claude Code:

| Group | Tools |
|---|---|
| Intake & Pipelines | `forge_submit_request`, `forge_run_agent_direct`, `forge_get_pipeline`, `forge_wait_pipeline`, `forge_list_pipeline_steps`, `forge_retry_pipeline_step`, `forge_cancel_pipeline` |
| Agents | `forge_list_agents`, `forge_get_agent`, `forge_hire_agent`, `forge_update_agent`, `forge_fire_agent` |
| Status & Jobs | `forge_get_status`, `forge_get_budget`, `forge_list_queue`, `forge_get_job` |
| Issues | `forge_list_issues`, `forge_get_issue`, `forge_create_issue`, `forge_update_issue` |
| Sprints | `forge_list_sprints`, `forge_create_sprint` |

---

## Development

```bash
npm run dev          # Start forge in dev mode (tsx, no build)
npm run build        # Build webui + compile TypeScript to dist/
npm run test         # Run unit tests with vitest
npm run lint         # TypeScript type-check only (no emit)
npm run webui:dev    # Vite dev server for the web UI (hot reload)
```

### Database

```bash
npm run db:generate  # Regenerate Prisma client after schema changes
npm run db:migrate   # Create and apply a new migration (requires interactive TTY)
npm run db:push      # Push schema directly without a migration file
```

> `prisma migrate dev` requires an interactive TTY. In CI, use `npx prisma migrate deploy` with pre-written SQL files under `prisma/migrations/`.

---

## Contributing — where to start

| Area | Location |
|---|---|
| Add a CLI command | `src/cli/commands/` — copy an existing command file |
| Add a TUI view | `src/cli/console/views/` — implement `render*(state, layout)` → `string[]` |
| Add a pipeline stage | `src/orchestrator/pipelines/` and register in `dispatcher.ts` |
| Add a server route | `src/server/routes/` and mount in `src/server/index.ts` |
| Add a runner provider | `src/bridge/runners/` and register in `factory.ts` |
| Change agent prompts | `ai-system/official/agents/` — plain markdown |
| Change data model | `prisma/schema.prisma`, then `npm run db:migrate` |
