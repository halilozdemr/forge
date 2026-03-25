# Skill: context-digest

Status: default-off

Purpose:
- Convert raw stage input + `PROJECT_CONTEXT.md` into a bounded context digest.

Input:
- `project_context_text`
- `stage_input`

Output:
- Exactly one output contract JSON (`artifact` | `decision_request` | `explicit_failure`).
- `artifact.artifact_type` should be `context_digest`.

Restrictions:
- Single-purpose utility only.
- No orchestration.
- No role assignment.
- No task/workflow creation.
- No official state mutation.
