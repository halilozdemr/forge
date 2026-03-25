# AI System (Official + User Extension Split)

This directory is the authoritative prompt/contract layer for Forge v3.
`PROJECT_CONTEXT.md` is the single source of truth for execution rules.

## Official Execution Model
Official stage chain:
1. `intake-gate`
2. `architect`
3. `builder`
4. `quality-guard`

Optional surrounding stages:
- `devops`
- `retrospective-analyst`

Rules:
- Intake-first is mandatory.
- Orchestration belongs to engine code, not prompts.
- Stage agents are stage-bound and contract-bound.

## Layout
- `official/agents/` official stage prompts
- `official/projections/` capability profiles (not standalone agents)
- `official/skills/` minimal utility skills, default-off
- `contracts/` shared output contract schema
- `user/agents/` user extension agents
- `user/skills/` user extension skills

## Authority Model
- Official runs are authoritative only when executed through official pipeline.
- User agents are extensions and non-authoritative by default.
- User agents do not join official pipeline automatically.

## Custom Agent Safety
To add custom agents safely:
1. Place files under `ai-system/user/agents/`.
2. Use non-reserved slugs.
3. Keep contract-compliant output behavior.
4. Register explicitly if pipeline integration is desired.
