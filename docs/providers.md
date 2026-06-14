# Runner providers

Each agent (pipeline stage) can be configured with a different provider and model. Set via `.forge/config.json` (created by `forge init`), live per-stage with `forge route set`, or per-agent with `forge agent edit --provider`.

The canonical list of backends Forge can dispatch to lives in `src/bridge/runners/providers.ts`; the runner factory, agent validation, and the `forge route` command all derive from it, so the set below is always exactly what the conductor can run.

## Available providers

| Provider | Value | Routable | Notes |
|---|---|---|---|
| Claude Code CLI | `claude-cli` | yes | Default. $0 cost — uses your existing Claude subscription. |
| Anthropic API | `anthropic-api` | yes | Direct API calls. Token costs tracked per job. |
| OpenRouter | `openrouter` | yes | Access to many models. Costs tracked. |
| OpenAI API | `openai` | yes | Chat Completions. `OPENAI_BASE_URL` override for compatible gateways. |
| Gemini CLI | `gemini-cli` | yes | Local Gemini CLI. |
| Gemini API | `gemini-api` | yes | Direct Gemini API. |
| Codex CLI | `codex-cli` | yes | OpenAI Codex CLI. |
| opencode CLI | `opencode-cli` | yes | opencode.ai integration. |
| Ollama | `ollama` | yes | Local models via Ollama. |
| Cursor Agent | `cursor` | yes | HTTP agent adapter (localhost:11000). |
| HTTP | `http` | no | Generic HTTP endpoint (internal bridge). |
| Process | `process` | no | Arbitrary shell process (internal bridge). |

Non-routable backends are runnable plumbing but are not offered as routing targets by `forge route`.

## Inspecting and changing routing

```bash
forge route                # stage -> provider/model table with backend availability
forge route providers      # routable backends and whether each is currently reachable
forge route set <stage> --provider <id> [--model <m>]
forge route preset [name]  # list or apply a heavy/light preset (--dry-run to preview)
```

## Cost tracking

Cost tracking applies to the metered API providers — `anthropic-api`, `openai`, `openrouter`, and `gemini-api`. Token usage is logged to the `CostEvent` table and aggregated monthly per company. Rates live in `src/bridge/pricing.ts` (USD per 1M tokens, matched per model).

CLI/local backends (`claude-cli`, `gemini-cli`, `codex-cli`, `opencode-cli`, `ollama`) report $0 — their cost is handled by your subscription/hardware outside Forge.

## Default model setup

`forge init` detects available providers and configures two tiers:

- **heavy** — used by compute-intensive agents (architect, reviewer). Default: `claude-cli/sonnet`.
- **light** — used by faster/simpler agents (builder, devops). Default: `claude-cli/sonnet` or a faster model if configured.

To override per-agent:

```bash
forge agent edit architect --provider openrouter --model anthropic/claude-opus-4
forge agent edit builder --provider gemini-cli --model gemini-2.0-flash
```

## Budget limits

```bash
forge budget set 20 --agent builder        # $20/month for builder
forge budget set 100                        # $100/month company-wide
forge budget set 50 --soft-pct 70 --action pause
forge budget show
forge budget report
```

When a hard limit is hit, the agent is auto-paused. Use `forge approval inbox` to see the resulting budget override request, then approve to unpause.
