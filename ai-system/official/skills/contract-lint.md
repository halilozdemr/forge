# Skill: contract-lint

Status: default-off

Purpose:
- Validate agent output JSON against the shared output contract schema.

Input:
- `candidate_output_json`
- `contract_schema`

Output:
- Exactly one output contract JSON (`artifact` | `decision_request` | `explicit_failure`).
- `artifact.artifact_type` should be `contract_lint_report`.

Restrictions:
- Validation utility only.
- No orchestration.
- No workflow generation.
- No task creation.
- No official state mutation.
