# Forge

A local-first AI workflow runner. Bootstrap a project with `forge init`, start Forge locally, and launch work from the CLI.

Forge runs entirely on your machine. It uses whatever AI CLI or API key you already have.

---

## How it works

```bash
forge init
forge start
forge feature create "add dark mode" --mode structured
forge workflow watch <run-id>
```

You start work with `forge feature create|run` and `forge bug create|run`.
At creation time, choose execution mode:
- **Fast** — simple tasks, quick iteration
- **Structured** — planning, checkpoints, approvals for larger work

---

## Architecture

| Component | What it does |
|---|---|
| **Server** | Fastify REST API on `localhost:3131`. Handles all CLI and Web UI requests. |
| **Worker** | BullMQ job worker. Picks up queued agent jobs, spawns the AI runner, streams output, writes logs and artifacts to SQLite. |
| **Queue** | In-process BullMQ queue backed by SQLite (no Redis required). |
| **Heartbeat** | Cron-based scheduler for agents configured with `heartbeatCron`. |
| **Web UI** | Vanilla TS SPA served by the Forge server at `http://localhost:3131`. |
| **MCP server** | `forge-mcp` — exposes 23 tools so Claude Code can act as the Receptionist orchestrator. |
| **SQLite / Prisma** | Single database file at `~/.forge/forge.db`. All state lives here. |

### Workflow stages (internal)

| Workflow kind | Stages (in order) |
|---|---|
| **feature** | `intake-gate` → `architect` → `builder` → `quality-guard` → `devops` → `retrospective-analyst` |
| **bug** | `intake-gate` → `architect` → `builder` → `quality-guard` → `devops` |
| **refactor** | `intake-gate` → `architect` → `builder` → `quality-guard` → `devops` |
| **release** | `intake-gate` → `architect` → `builder` → `quality-guard` → `devops` → `retrospective-analyst` |

Stages run sequentially with `dependsOn` resolution. Each stage produces a typed artifact stored in the `IssueWorkProduct` table.

---

## Prerequisites

- **Node.js 18+**
- At least one of:
  - **Claude Code CLI** (`claude`) — recommended, $0 cost (uses your existing subscription)
  - **Gemini CLI** (`gemini`)
  - **Codex CLI** (`codex`)
  - Or an API key for OpenRouter, Anthropic API, or OpenAI

```bash
node --version   # must be >= 18
claude --version # or gemini / codex
```

---

## Installation

```bash
git clone https://github.com/halilozdemr/forge.git
cd forge
npm install
npm run build
npm link          # makes `forge` available globally
```

Or run without building:

```bash
npm run dev       # runs forge start via tsx (no build needed)
```

---

## Project initialization

Run `forge init` once in a project directory to create `.forge/config.json`:

```bash
cd your-project
forge init
```

Init is bootstrap-only. It helps you:
- detect local provider tools
- add optional API keys
- configure model defaults (Automatic or Manual heavy/light)
- optionally enable Telegram notifications

`forge init --yes` runs non-interactively with defaults.

The resulting `.forge/config.json` is read by `forge start` on every launch. The file is gitignored by default.

---

## Starting Forge

```bash
forge start
```

This will:
1. Run any pending database migrations
2. Seed default company, project, and agent team
3. Start the job worker (default concurrency: 3)
4. Start the heartbeat scheduler
5. Start the HTTP server on port 3131
6. Write a PID file for `forge stop`

**Options:**

```bash
forge start --port 3200        # use a different port
forge start --concurrency 5    # run up to 5 jobs in parallel
```

The Web UI is available at `http://localhost:3131` once running.

---

## System commands

```bash
forge status    # show server state, queue depth, agent counts, heartbeat
forge stop      # gracefully stop the running server (SIGTERM)
forge doctor    # check all prerequisites and diagnose setup issues
```

### `forge doctor` checks

- Claude / Gemini / Codex CLI availability
- `.forge/config.json` presence and validity
- SQLite database file
- API keys (OpenRouter, Anthropic, OpenAI)
- Server reachability
- Node.js version

---

## Main usage

### Submit a feature request

```bash
forge feature create "add CSV export to reports page"
forge feature create "add dark mode" --description "User-controlled theme toggle, persisted in localStorage"
forge feature create "add dark mode" --mode structured
forge feature create "add dark mode" --mode fast
```

Both `create` and `run` start work. If `--mode` is omitted in an interactive terminal, Forge asks you to choose Fast or Structured.

Output:

```
Feature request created.

  Issue:   clxxx...
  Mode:    Structured — planning, checkpoints, approvals for larger work
  Run ID:  clyyy...
  Status:  running
  Steps:   ...

  Watch:   forge workflow watch clyyy...
  Inspect: forge workflow show clyyy...
```

### Submit a bug report

```bash
forge bug create "login form crashes on empty email submission"
forge bug create "race condition in queue worker" --description "Happens under high concurrency"
forge bug create "fix crash on launch" --mode structured
```

### Watch a workflow run

```bash
forge workflow watch <run-id>
```

Polls every 3 seconds and prints each status change until the run reaches a terminal state (`completed`, `failed`, or `cancelled`).

```
Watching workflow clyyy... — press Ctrl+C to stop

[14:03:01] running              step: intake-gate           ██░░░░░░░░ 0/6 (0%)
[14:03:11] running              step: architect             ████░░░░░░ 1/6 (17%)
[14:03:44] running              step: builder               ██████░░░░ 2/6 (33%)
...
Workflow COMPLETED.
```

### List and inspect workflows

```bash
forge workflow list                         # all recent runs
forge workflow list --status running        # only active runs
forge workflow list --type bug              # filter by work kind
forge workflow list --limit 50

forge workflow show <run-id>                # full step timeline with durations and summaries
```

### Approve or reject agent requests

Some actions (hiring a new agent, unblocking a paused budget) require human approval before they execute.

```bash
forge approval inbox                        # show pending approvals with context and ready-to-run hints
forge approval list                         # raw list (no descriptions)
forge approval approve <id>
forge approval reject <id> --reason "Not needed this sprint"
```

### Live log stream

```bash
forge logs                    # stream all agent output to stderr
forge logs --agent builder    # filter to one agent
```

Output goes to stderr — safe to use alongside other terminal output, does not consume Claude Code tokens.

---

## Web UI

Open `http://localhost:3131` after `forge start`.

| Page | URL | What you can do |
|---|---|---|
| Overview | `#/` | System health, queue summary, agent status |
| Workflows | `#/workflows` | List all workflow runs, click to open detail |
| Workflow Detail | `#/workflows/:id` | Step timeline, cancel, retry failed steps, view per-step logs, view artifacts |
| Approvals | `#/approvals` | Approve or reject pending approval requests |
| Agents | `#/agents` | List and inspect agent configuration |
| Issues | `#/issues` | All submitted issues (read-only view) |
| Queue | `#/queue` | Raw job queue state |
| Budget | `#/budget` | Cost tracking and policy overview |

The Workflow Detail page auto-polls every 4 seconds. You can open the log viewer panel for any completed step to replay the full captured output.

---

## Agent management

```bash
forge agent list                           # list all agents and their status
forge agent get <slug>                     # inspect a single agent
forge agent edit <slug> --model gpt-4o --provider openrouter
forge agent edit <slug> --prompt-file ./my-prompt.md
forge agent edit <slug> --status paused
```

Agents are seeded automatically on `forge start`. You can edit them live without restarting.

---

## Budget management

Forge tracks token costs for `anthropic-api` and `openrouter` providers. The `claude-cli` provider reports $0 (it uses your existing subscription).

```bash
forge budget set 20 --agent builder               # $20/month for the builder agent
forge budget set 100                               # $100/month company-wide
forge budget set 50 --soft-pct 70 --action pause  # pause agent at $50, warn at $35
forge budget show
```

When a hard limit is hit, the agent is auto-paused. Use `forge approval inbox` to see the resulting budget override request, then approve it to unpause.

---

## MCP integration (Claude Code as Receptionist)

Forge ships a Model Context Protocol server that lets Claude Code orchestrate Forge from inside a conversation.

### Setup

Add to your Claude Code MCP config (`.claude/settings.json` or global settings):

```json
{
  "mcpServers": {
    "forge": {
      "command": "npx",
      "args": ["forge-mcp"],
      "cwd": "/path/to/project"
    }
  }
}
```

### Available tools

| Group | Tools |
|---|---|
| Agents | `forge_list_agents`, `forge_get_agent`, `forge_hire_agent`, `forge_update_agent`, `forge_fire_agent` |
| Intake & Pipelines | `forge_submit_request`, `forge_run_agent_direct`, `forge_get_pipeline`, `forge_wait_pipeline`, `forge_list_pipeline_steps`, `forge_retry_pipeline_step`, `forge_cancel_pipeline` |
| Issues (admin) | `forge_list_issues`, `forge_get_issue`, `forge_create_issue`, `forge_update_issue`, `forge_run_issue` |
| Sprints | `forge_list_sprints`, `forge_create_sprint` |
| Status & Jobs | `forge_get_status`, `forge_get_budget`, `forge_list_queue`, `forge_get_job` |

`forge_submit_request` is the primary intake tool. Use `forge_run_agent_direct` to invoke a specific agent (e.g. `architect`) without going through the full pipeline.

---

## Runner providers

Configured per-agent in `.forge/config.json` or via `forge agent edit --provider`.

| Provider | Value | Notes |
|---|---|---|
| Claude Code CLI | `claude-cli` | Default. $0 cost, uses your Claude subscription. |
| Anthropic API | `anthropic-api` | Direct API calls. Costs tracked per job. |
| OpenRouter | `openrouter` | Access to many models. Costs tracked. |
| Gemini CLI | `gemini-cli` | Local Gemini CLI. |
| Gemini API | `gemini-api` | Direct Gemini API. |
| Codex CLI | `codex-cli` | OpenAI Codex CLI. |
| opencode CLI | `opencode-cli` | opencode.ai integration. |
| Ollama | `ollama` | Local models via Ollama. |
| HTTP | `http` | Generic HTTP endpoint. |
| Process | `process` | Arbitrary shell process. |

---

## Repository structure

```
.
├── src/
│   ├── cli/              # All forge CLI commands
│   │   └── commands/     # One file per command
│   ├── server/           # Fastify REST API
│   │   └── routes/       # One file per route group
│   ├── bridge/           # Job worker and runner abstraction
│   │   ├── worker.ts     # Main job processor
│   │   ├── queue.ts      # BullMQ queue setup
│   │   ├── stream-helpers.ts  # Pure stream processing utilities
│   │   └── runners/      # Provider-specific runner classes
│   ├── orchestrator/     # Pipeline definitions
│   │   └── pipelines/    # feature.ts, bug.ts, refactor.ts, release.ts
│   ├── agents/           # Agent registry, loader, defaults
│   ├── db/               # Prisma client, migrations, seed
│   ├── mcp/              # MCP server (forge-mcp binary)
│   ├── heartbeat/        # Heartbeat cron scheduler
│   └── utils/            # Config, logger, crypto, process helpers
├── webui/                # Vite + vanilla TS web interface
│   └── src/
│       ├── api/          # Typed fetch helpers for each API group
│       ├── components/   # Pages and layout components
│       └── router/       # Hash-based SPA router
├── prisma/
│   ├── schema.prisma     # Full data model
│   └── migrations/       # SQL migration files
├── ai-system/            # Authoritative agent prompt and contract layer
│   ├── official/agents/  # Stage agent prompts (intake-gate, architect, etc.)
│   ├── official/projections/  # Capability profiles
│   ├── contracts/        # Output contract JSON schema
│   └── user/             # User-defined agent extensions
└── .forge/               # Runtime data — gitignored
    ├── config.json        # Project config (created by forge init)
    └── forge.db           # SQLite database
```

---

## Development

```bash
npm run dev          # Start forge in dev mode (tsx, no build)
npm run build        # Build webui + compile TypeScript to dist/
npm run test         # Run unit tests with vitest
npm run lint         # TypeScript type-check only (no emit)
npm run webui:dev    # Vite dev server for the web UI (hot reload)
```

### Database migrations

```bash
npm run db:generate  # Regenerate Prisma client after schema changes
npm run db:migrate   # Create and apply a new migration (requires interactive TTY)
npm run db:push      # Push schema directly without a migration file
```

> **Note:** `prisma migrate dev` requires an interactive TTY. In non-interactive environments (CI, scripts), use `npx prisma migrate deploy` with pre-written SQL migration files under `prisma/migrations/`.

---

## Troubleshooting

**Server won't start — port already in use**
```bash
forge status         # check if another instance is running
forge stop           # stop it, or kill the process manually
forge start --port 3200
```

**Agent jobs not processing**
```bash
forge status         # check queue: running/pending counts
forge queue list     # inspect raw queue state
forge logs           # watch live worker output
```

**Agent paused unexpectedly**
```bash
forge approval inbox  # check for pending budget override requests
forge agent list      # confirm agent status
```

**Database issues / schema out of sync**
```bash
npx prisma migrate deploy   # apply any pending migrations
npm run db:generate         # regenerate Prisma client
```

**`forge doctor` fails on Claude CLI**

Make sure `claude` is on your PATH, or set `CLAUDE_CLI_PATH` in your environment:
```bash
export CLAUDE_CLI_PATH=~/.local/bin/claude
```

---

## Known limitations

- **`forge login` / Forge Cloud** — the `login` and `logout` commands stub out a cloud auth flow. No public Forge Cloud service exists. These commands are non-functional without a self-hosted cloud backend.
- **`forge issue run` is deprecated** — use `forge feature run` or `forge bug run` instead. The `issue run` command still works but prints a deprecation warning.
- **Pipeline stages are sequential** — parallel stage execution is not supported. Each stage waits for its `dependsOn` stages to complete.
- **No built-in git integration** — the `devops` agent can be prompted to create branches and PRs, but Forge does not manage git automatically.
- **Cost tracking is provider-scoped** — only `anthropic-api` and `openrouter` jobs contribute to budget counters. `claude-cli` jobs report $0.
- **Single-node only** — the queue and worker run in the same process as the server. Distributed workers are not supported.

---

## Roadmap note

The current implementation is a working local orchestration runtime. Active areas of work include improving artifact visibility in the Web UI, adding native git worktree support for isolated builds, and hardening the pipeline retry and error recovery paths.
