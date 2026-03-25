# AI System

This directory is the authoritative prompt and contract layer for Forge.

## Official pipeline stages

All pipelines share the same stage chain. Order and inclusion vary by pipeline type:

| Stage | Role |
|---|---|
| `intake-gate` | Normalize the request into a structured `execution_brief` |
| `architect` | Produce an `architecture_plan` from the brief |
| `builder` | Implement the change in the workspace, return `work_result` |
| `quality-guard` | Validate artifacts against brief and plan |
| `devops` | Assess branch/PR/release readiness, return `devops_report` |
| `retrospective-analyst` | Produce a `learning_report` from the completed run (feature and release only) |

Rules:
- `intake-gate` is always the first stage. All other stages depend on it.
- Orchestration logic lives in `src/orchestrator/pipelines/`, not in prompts.
- Stage agents are stage-bound: they receive input, produce a typed artifact, and stop.

## Directory layout

```
official/agents/        Official stage prompt files
official/projections/   Capability profiles (used by MCP/receptionist)
contracts/              Shared output contract JSON schema
user/agents/            User-defined extension agents (non-authoritative by default)
user/skills/            User-defined extension skills
```

## Adding custom agents

1. Place files under `ai-system/user/agents/`.
2. Use slugs that do not conflict with official stage names.
3. Produce contract-compliant output (`artifact`, `decision_request`, or `explicit_failure`).
4. Register explicitly in a pipeline definition if pipeline integration is desired.
