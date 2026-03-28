# Runner providers

Each agent can be configured with a different provider and model. Set via `.forge/config.json` (created by `forge init`) or live with `forge agent edit --provider`.

## Available providers

| Provider | Value | Notes |
|---|---|---|
| Claude Code CLI | `claude-cli` | Default. $0 cost — uses your existing Claude subscription. |
| Anthropic API | `anthropic-api` | Direct API calls. Token costs tracked per job. |
| OpenRouter | `openrouter` | Access to many models. Costs tracked. |
| Gemini CLI | `gemini-cli` | Local Gemini CLI. |
| Gemini API | `gemini-api` | Direct Gemini API. |
| Codex CLI | `codex-cli` | OpenAI Codex CLI. |
| opencode CLI | `opencode-cli` | opencode.ai integration. |
| Ollama | `ollama` | Local models via Ollama. |
| HTTP | `http` | Generic HTTP endpoint. |
| Process | `process` | Arbitrary shell process. |

## Cost tracking

Cost tracking applies to `anthropic-api` and `openrouter` only. Token usage is logged to the `CostEvent` table and aggregated monthly per company.

`claude-cli` reports $0 — costs are handled by your Claude subscription outside Forge.

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
