# User Agent Extensions

Custom agents under `ai-system/user/` are extensions, not official pipeline stages.

## Placement
- Custom agents: `ai-system/user/agents/*.md`
- Custom skills: `ai-system/user/skills/*.md`

## Naming Rules
- Use lowercase kebab-case slugs.
- Do not use reserved official slugs:
  - `intake-gate`
  - `architect`
  - `builder`
  - `quality-guard`
  - `devops`
  - `retrospective-analyst`

## Authority Rules
- Official pipeline is authoritative.
- Custom agents are non-authoritative by default.
- Custom agents do not mutate official state unless explicitly integrated by engine rules.
- Direct-run custom agents are advisory/non-authoritative unless explicitly wired into pipeline configuration.

## Pipeline Compatibility (Opt-in)
To be pipeline-compatible, a custom agent must:
- emit exactly one contract-compliant JSON output
- avoid orchestration/handoff/task-creation behavior
- avoid official state mutation claims
- be explicitly registered by engine config (not auto-loaded)
