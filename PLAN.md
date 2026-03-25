## 1. Repository re-validation summary

**Confirmed (from code):**
- Runtime-centric architecture is real: intake -> pipeline run -> step runs -> queue jobs -> worker execution -> persisted state in SQLite via Prisma.
- CLI and Web UI are thin-ish clients over runtime APIs, but CLI still has some direct DB writes and direct runner execution paths.
- SQLite/Prisma is the operational source for runs, steps, jobs, issues, agents, costs, approvals, and artifacts-like records.
- MCP adapter is implemented and calls runtime REST, including intake-first tools (`forge_submit_request`) and pipeline tracking.
- Web UI exists and is served by Fastify static hosting, but IA is partial (no workflows/approvals/artifacts/runtime/settings pages yet).

**Important module map (confirmed):**

| Area | Primary files | Responsibility |
|---|---|---|
| CLI entry/surface | [src/cli/index.ts](/Users/halilozdemir/Desktop/claude-cli-bridge/v3/src/cli/index.ts), [bin/forge.ts](/Users/halilozdemir/Desktop/claude-cli-bridge/v3/bin/forge.ts) | Command tree registration |
| Runtime server | [src/server/index.ts](/Users/halilozdemir/Desktop/claude-cli-bridge/v3/src/server/index.ts) | Fastify API + WebSocket + static Web UI |
| Intake + pipelines | [src/orchestrator/intake.ts](/Users/halilozdemir/Desktop/claude-cli-bridge/v3/src/orchestrator/intake.ts), [src/orchestrator/dispatcher.ts](/Users/halilozdemir/Desktop/claude-cli-bridge/v3/src/orchestrator/dispatcher.ts), [src/orchestrator/pipelines/feature.ts](/Users/halilozdemir/Desktop/claude-cli-bridge/v3/src/orchestrator/pipelines/feature.ts) | Pipeline creation, step lifecycle, retry/cancel |
| Queue + worker | [src/bridge/queue.ts](/Users/halilozdemir/Desktop/claude-cli-bridge/v3/src/bridge/queue.ts), [src/bridge/worker.ts](/Users/halilozdemir/Desktop/claude-cli-bridge/v3/src/bridge/worker.ts) | SQLite queue leasing, runner execution, status updates |
| Persistence | [prisma/schema.prisma](/Users/halilozdemir/Desktop/claude-cli-bridge/v3/prisma/schema.prisma) | Core data model |
| Agents | [src/agents/constants.ts](/Users/halilozdemir/Desktop/claude-cli-bridge/v3/src/agents/constants.ts), [src/agents/registry.ts](/Users/halilozdemir/Desktop/claude-cli-bridge/v3/src/agents/registry.ts), [src/server/routes/agents.ts](/Users/halilozdemir/Desktop/claude-cli-bridge/v3/src/server/routes/agents.ts) | Official/user slugs, prompt resolution, CRUD |
| AI system templates | [ai-system/official/agents](/Users/halilozdemir/Desktop/claude-cli-bridge/v3/ai-system/official/agents), [ai-system/user/agents](/Users/halilozdemir/Desktop/claude-cli-bridge/v3/ai-system/user/agents) | Official and custom prompt layer |
| MCP | [src/mcp/index.ts](/Users/halilozdemir/Desktop/claude-cli-bridge/v3/src/mcp/index.ts), [bin/forge-mcp.ts](/Users/halilozdemir/Desktop/claude-cli-bridge/v3/bin/forge-mcp.ts) | External AI tool automation surface |
| Web UI | [webui/src/main.ts](/Users/halilozdemir/Desktop/claude-cli-bridge/v3/webui/src/main.ts), [webui/src/components/pages](/Users/halilozdemir/Desktop/claude-cli-bridge/v3/webui/src/components/pages) | Ops console (current pages: overview/agents/issues/sprints/queue/budget) |

**Partial/stubbed/implied (not fully productized yet):**
- Workflow definitions are code-hardcoded, not DB-registered/versioned.
- Contract schema exists, but runtime does not enforce/parse official output contract semantics.
- Approvals exist but only for limited types (`hire_agent`, `budget_override` processing paths); no general workflow gate system.
- Artifact/log systems are partial: `issue_work_products` and `pipeline_step_runs.resultSummary` exist, but no typed workflow artifact registry and no persisted step log stream.
- Budget policy `action` is stored but not fully honored in enforcement logic.
- Web UI has data-shape mismatches on some pages and lacks primary workflow operations pages.

**Naming inconsistency (confirmed):**
- `Forge` and `Firm` coexist: `FirmOrchestrator`, `FirmConfig`, `.firm/.pid`, `.firm` config fallback, and “The Firm” strings remain in runtime.
- `.forge` is primary in most flows, but `.firm` remains in process/config compatibility paths.
- Route-driven and internal terms (`issues`, `pipeline`) dominate; product terms (`feature`, `bug`, `workflow run`, `artifact`) are only partially surfaced.

**Confidence / uncertainty:**
- High confidence on runtime/API/DB shape from direct file + schema inspection and passing tests/build.
- Medium confidence on intended product semantics where docs conflict with code (some docs are stale and reference older architecture).

---

## 2. Target product model

### Current -> target mapping table

| Target entity | Exists now? | Current equivalent | Keep/rename/merge | CLI surface target | Web UI surface target |
|---|---|---|---|---|---|
| Workspace | Partial | `Project.path` + `ExecutionWorkspace` | Keep; expose explicitly | `forge workspace show/switch/policy` | Workspace switcher + policy settings |
| Project | Yes | `Project` table | Keep | `forge project list/use` | Project switcher |
| Work Item | Yes | `Issue` | Keep internal name `Issue`, surface as Work Item | `forge work list/show/update` | Work item list/detail |
| Feature | Yes | `Issue.type='feature'` + intake type | Keep as first-class entrypoint | `forge feature create/run` | Create Feature flow |
| Bug | Yes | `Issue.type='bug'` + intake type | Keep as first-class entrypoint | `forge bug create/run` | Create Bug flow |
| Workflow Definition | Partial | Hardcoded pipeline builders | Add explicit registry | `forge workflow defs` | Settings -> Workflow Definitions |
| Workflow Run | Yes | `PipelineRun` | Keep; surface as Workflow Run | `forge workflow list/show/watch` | Workflows page |
| Workflow Step | Yes | `PipelineStepRun` | Keep; surface as Step | `forge workflow steps` | Workflow Detail timeline |
| Agent | Yes | `Agent` | Keep | `forge agent ...` | Agents page |
| Agent Template | Partial | `ai-system/official|user` md files | Keep + versioned registry projection | `forge agent template ...` | Agent Templates tab |
| Custom Agent | Partial | User agents in DB; optional `ai-system/user/agents` prompts | Keep + validate strongly | `forge agent create --custom` | Create/Edit custom agent |
| Artifact | Partial | `IssueWorkProduct` | Evolve to typed workflow artifacts | `forge artifact list/show/export` | Artifacts page |
| Log Stream | Partial | WS heartbeat.log + step summary + activity log | Add persisted run/step logs | `forge logs run/step/tail` | Workflow log pane |
| Approval | Partial | `Approval` table + approval routes | Keep + broaden gate types | `forge approval inbox/act` | Approvals page |
| Budget Policy | Yes | `BudgetPolicy` | Keep; enforce fully | `forge budget policy ...` | Budget policy management |
| Cost Event | Yes | `CostEvent` | Keep; add run/step linkage | `forge budget report` | Budget detail/report |
| Sprint | Yes | `Sprint` | Keep | `forge sprint ...` | Planning -> Sprints |
| Goal | Yes (DB + CLI direct) | `Goal` table | Keep; add API/UI | `forge goal ...` | Planning -> Goals |
| Runtime Health / Node / Queue Pressure | Partial | `/health`, `/v1/status`, queue counts | Consolidate runtime view | `forge runtime status` | Runtime page |

**Product-facing naming recommendation:**
- User-facing: Work Item, Feature, Bug, Workflow, Run, Step, Approval, Artifact.
- Internal compatibility: keep `Issue`, `PipelineRun`, `PipelineStepRun` until late migration.

---

## 3. Source of truth and system boundaries

### Source of truth plan

| Domain | Current truth | Target truth |
|---|---|---|
| Runtime execution state | SQLite tables (`pipeline_runs`, `pipeline_step_runs`, `queue_jobs`, `issues`) | Keep DB as authoritative |
| Bootstrap config | `.forge/config.json` (+ `.firm` fallback in some places) | `.forge/config.json` bootstrap only; no repeated forced override on every start |
| Agent templates | `ai-system/official` + `ai-system/user` files | Keep templates file-based; runtime stores resolved active agent config in DB |
| Seeded agents | `seedDatabase()` from config/start | Keep seeding but idempotent bootstrap mode; avoid force-overwriting runtime edits by default |
| Custom agents | DB `Agent` rows + optional prompt files | DB authoritative for active custom agents; template files are optional authoring source |
| Project-local agent projections | `.opencode/agents` generated | Keep generated projections as client integration artifact, not runtime truth |
| Artifacts | `issue_work_products` | Evolve to typed workflow artifacts table; keep compatibility mirror |
| Logs | WS ephemeral + activity + queue/job result snippets | Add persisted run/step logs as SoT for replay/tail |
| Approvals | `approvals` table | Keep; tie approvals to workflow gates/scopes |
| Budgets | `budget_policies` + `cost_events` | Keep; add consistent enforcement semantics |

### Explicit files/directories
- `.forge/config.json`: bootstrap + local env hints. Should not be the live control-plane source after runtime boot.
- `.firm/config.json`: compatibility read path only, deprecated.
- `ai-system/official`: official template source.
- `ai-system/user`: user template source for custom extensions.
- `seeded agents`: created in DB by [src/db/seed.ts](/Users/halilozdemir/Desktop/claude-cli-bridge/v3/src/db/seed.ts).
- `custom agents`: DB records via API/CLI; optional prompt file.
- `artifacts/logs/approvals/budgets`: runtime DB-backed.

### Boundary responsibilities

| Layer | Responsibility | Must not own |
|---|---|---|
| CLI | Product-intent commands, orchestration UX, human-readable output | Direct business logic duplication; direct DB writes for core workflows |
| Web UI | Operations console + actions via APIs | Runtime decision logic |
| Runtime server | API contracts, projections, authz/policy checks, event publication | Long-running execution logic internals |
| Dispatcher/orchestrator | Workflow state machine + transitions + retry/cancel semantics | Provider-specific execution |
| Worker/queue | Job leasing/execution, cost capture, artifact/log emission | Product routing semantics |
| MCP server | External tool-friendly wrappers over runtime contracts | Owning business workflows itself |

---

## 4. Recommended CLI product surface

### Keep (unchanged)
- `forge init`
- `forge start`
- `forge stop`
- `forge status`
- `forge doctor`

### New coherent command tree (product-oriented)

```bash
forge workspace show|switch|policy
forge project list|use
forge feature create|run|list
forge bug create|run|list
forge work list|show|update            # unified work items
forge workflow list|show|watch|cancel|retry-step
forge agent list|inspect|create|edit|delete|revisions|rollback
forge approval inbox|approve|reject
forge artifact list|show|export
forge logs tail|workflow|step
forge budget policy set|show|report
forge plan sprint list|show|create|start|close
forge plan goal list|create|link
forge web open|serve-status
forge settings show|set
```

### Compatibility strategy
- Preserve existing groups as aliases:
  - `forge issue ...` -> alias to `forge work ...`
  - `forge sprint ...` -> alias to `forge plan sprint ...`
  - `forge queue status` -> alias to `forge workflow watch` or `forge runtime queue`
  - `forge label`, `forge secret`, `forge company` remain advanced/admin groups.
- Preserve route-shaped admin actions:
  - `forge issue run` marked legacy (non-authoritative), encourage `forge feature run` / `forge bug run`.
  - `forge agent run` marked direct-advisory mode.
- Add deprecation notices in output for legacy commands during a 2-phase window.

### Command-group evaluation

| Group | User intent | Runtime/API mapping | Reuse now | Missing backend | Risk |
|---|---|---|---|---|---|
| `feature` / `bug` | Start official workflows | `POST /v1/intake/requests` | Intake API + dispatcher | CLI wrappers + list/detail projections | Low |
| `workflow` | Inspect/control runs | `/v1/pipelines/:id`, `/steps`, cancel/retry | Existing endpoints | Need list endpoint + watch optimization | Low/Medium |
| `approval` | Gate decisions | `/v1/approvals*` | Existing CLI/API | Needs richer approval metadata + inbox filters | Medium |
| `artifact` | Inspect outputs | `/v1/issues/:id/work-products` | Existing data path | Need run/step-scoped artifact APIs | Medium |
| `logs` | Real-time + replay | WS `/ws` + future log APIs | Live WS exists | Persisted log APIs missing | Medium |
| `budget` | Control spend | `/v1/budget/*` | Existing | Enforce action semantics consistently | Medium |
| `plan` | Sprint/goal planning | Sprint API + Goal DB | Sprints partially | Goal API missing; CLI currently DB-direct | Medium |
| `web` | Open ops console | local URL | Easy wrapper | none | Low |

### CLI examples (target)
```bash
forge feature create --title "OAuth login" --description "Google + Apple" --run
forge workflow list --status running
forge workflow show prun_123
forge workflow watch prun_123
forge approval inbox
forge artifact list --workflow prun_123
forge logs workflow prun_123 --follow
forge web open
```

---

## 5. Recommended Web UI product surface

### Primary navigation (target)
- Overview
- Workflows
- Approvals
- Artifacts
- Work Items
- Agents
- Budget
- Planning
- Runtime
- Settings

### Advanced/internal secondary surfaces
- Queue internals, raw event emitter, legacy bridge endpoints, import/export admin.

### Current pages -> target IA

| Page | Stay/merge/remove | Exact purpose | Current support | Gaps | Target actions |
|---|---|---|---|---|---|
| Overview | Stay | Executive runtime snapshot | Exists | No workflow-centric summary | Jump to active runs, pending approvals |
| Issues | Rename to Work Items | Item backlog + linkage to workflows | Exists (kanban) | Status/type mismatch; no workflow-first controls | Create Feature/Bug, open run detail |
| Queue | Downgrade to Runtime subview | Low-level job monitor | Exists | Data-shape mismatch with API | Inspect queue pressure/errors |
| Sprints | Move under Planning | Sprint lifecycle | Exists | API query mismatch (`companyId` vs `projectId`) | Start/close sprint, manage sprint items |
| Agents | Stay | Agent fleet management | Exists | Needs custom-agent safety/policy UX | Create/edit/retire, validate compatibility |
| Budget | Stay | Spend policy + usage | Exists | Placeholder limits, delete TODO, wrong field mapping | Set policy, review overruns, approve overrides |
| Workflows | New primary | List/filter runs | Partial via issue pipeline summary | No dedicated page/API | Watch runs, cancel/retry |
| Workflow Detail | New | Step timeline + artifacts + logs + approvals | Partial via `/pipelines/:id` + step summaries | No full logs/artifact typing | Retry step, approve gate, export artifacts |
| Approvals | New | Approval inbox | API + CLI exist | No UI page | Approve/reject with context |
| Artifacts | New | Search/export outputs | Work-products exist | No run/step artifact model page | View/download artifact |
| Runtime | New | Health, queue pressure, workers, schedules | `/health`, `/v1/status` exist | Not consolidated | Diagnose runtime issues |
| Settings | New | Workspace/project/provider/config policy | Context + config indirect | No settings APIs | Change active workspace/project/policy |
| Workspace/Project switcher | New global element | Scope all views/actions | `/v1/context` exists | no list/select APIs | Switch scope without restart |
| Planning | New section | Sprint + goal + roadmap | Sprint exists, goal CLI direct DB | Goal API/UI missing | Plan goals, link work items |

### Relationship: Overview vs Workflows vs Queue vs Runtime
- Overview: business + operational at-a-glance.
- Workflows: primary execution object model.
- Queue: internal execution plumbing (secondary).
- Runtime: health/capacity diagnostics (operational).

---

## 6. Workflow system design

### 6A. Workflow definition model (target)

**Definition object:**
- `workflow_key` (`feature`, `bug`, `refactor`, `release`, `direct`)
- `version`
- `stages[]` with `stage_key`, `agent_slug`, `depends_on`, `retry_policy`, `approval_gate`, `artifact_rules`, `log_level`
- `terminal_policies` (`success`, `failure`, `cancel` semantics)

**State model (run):**
```text
pending -> running -> completed
pending -> running -> failed
pending -> running -> cancelled
failed -> running (manual retry gate)
cancelled -> (no resume unless explicit "reopen")
```

**State model (step):**
```text
pending -> queued -> running -> completed
running -> failed
running -> cancelled
failed -> pending (manual retry)
```

**Retry rules:**
- Queue retry remains bounded (`attempts/maxAttempts`).
- Step-level retry policy explicit in definition.
- Manual retry only on failed steps unless policy allows auto-loop.
- Max revision loops explicit per stage (existing `loopsBackTo/maxRevisions` can be activated).

**Approval gates:**
- Gate evaluation points at stage boundaries.
- Run pauses in `awaiting_approval` substate.
- Approval object linked to `pipelineRunId` + `stepKey`.

**Artifact rules:**
- Every completed step emits typed artifact(s) or explicit “no artifact” marker.
- Final run emits a `workflow_summary` artifact.

**Log rules:**
- Stream live logs per step.
- Persist normalized step log entries for replay and CLI/UI tail.

**Cancellation semantics:**
- Cancels pending/queued/running steps.
- Marks pending/running queue jobs cancelled.
- Emits final run cancellation event.

**Resume semantics:**
- `retry-step` resumes from failed step respecting dependency graph.
- Optional future `resume-run` for paused approval states.

### 6B. Feature workflow (concrete)

**Stages:**
1. `intake-gate` -> normalize request into `execution_brief`.
2. `architect` -> produce `architecture_plan`.
3. `builder` -> produce `work_result`.
4. `quality-guard` -> produce `validation_report`.
5. `devops` (conditional) -> produce `devops_report`.
6. `retrospective-analyst` (optional, async or terminal stage) -> produce `learning_report`.

**Approvals:**
- Optional gate after `architect` for high-risk/system-wide changes.
- Optional gate before `devops` for deployment-affecting actions.

**Retry policy:**
- Auto retry transport/execution failures by queue policy.
- Manual retry for semantic failures.
- Optional bounded loop `quality-guard -> builder` with max revisions.

**Success semantics:**
- Mandatory stages completed and no unresolved approvals.
- Run status `completed`; work item status `done`.

**Failure semantics:**
- Any mandatory stage hard-fails and retry budget exhausted or rejected approval.
- Run `failed`; work item `failed`.

### 6C. Bug workflow (concrete)

**Stages:**
1. `intake-gate` -> bug reproduction brief.
2. `debugger` (future official stage; fallback currently architect/builder split) -> root cause artifact.
3. `architect` -> fix strategy.
4. `builder` -> fix implementation.
5. `quality-guard` -> regression validation.
6. `devops` (conditional) -> hotfix readiness artifact.

**Approvals:**
- Optional gate before `devops` for production-impacting hotfix paths.
- Optional budget override gate if hard policy hit.

**Retry policy:**
- Same bounded queue retry + manual step retry.
- Allow one fast-loop fix pass for failed validation.

**Success/failure semantics:**
- Success: validated fix + optional release readiness.
- Failure: unresolved root cause or validation failure after retry budget.

### 6D. Optional future workflows
- `maintenance` (dependency/security patch cadence).
- `incident` (time-boxed triage + containment + postmortem).
- `migration` (schema/platform migrations with stronger approvals).

---

## 7. Agent system design

### 7A. System agents (product-grade)

| Agent | Purpose | Required capabilities | Provider/model strategy | Workflow role |
|---|---|---|---|---|
| `intake-gate` | Normalize intake | read/task only | fast/cheap model | Entry stage |
| `architect` | Technical planning | read/analysis, optional bash read-only contexts | stronger reasoning model | Planning gate |
| `builder` | Implementation | read/edit/write/bash scoped | strong coding model | Build stage |
| `quality-guard` | Validation | read/test execution | strong reasoning + test awareness | Quality gate |
| `devops` | Operational readiness | read/bash/deploy checks | medium/strong ops model | Delivery stage |
| `retrospective-analyst` | Learning artifact | read/summary | light model | Terminal insight stage |
| `debugger` (future official) | Root cause isolation | read/test/debug | strong diagnostic model | Bug workflows |

### 7B. Custom agents

**Definition:**
- User-defined agent with slug, role, provider/model, permissions, optional prompt template file.

**Runtime SoT:**
- DB `Agent` row is authoritative active config.
- Prompt source precedence: `promptFile` -> official/user template fallback -> generic fallback.

**Validation lifecycle:**
- Create/update validation:
  - slug namespace rules
  - provider/model support
  - permissions schema
  - optional template contract lint
  - stage compatibility declaration
- Activation validation:
  - ensure required capabilities for assigned stages.

**Permission model:**
- Keep boolean permission schema for v1 compatibility (`read/edit/write/bash/task`).
- Add normalized capability profile + risk level metadata.
- Dangerous capabilities require approval for selected scopes.

**Workflow integration safety:**
- Default: custom agents are non-authoritative and excluded from official workflows.
- Opt-in: explicit stage-compatibility and approval policy required to include in workflow definitions.

**CLI management model:**
- `forge agent create/edit/delete`
- `forge agent validate <slug>`
- `forge agent enable-stage <slug> --workflow feature --stage ...`

**Web UI management model:**
- Agents page with “System / Custom” segmentation.
- Validation status chips, compatibility matrix, approval requirements panel.

### 7C. Agent templates

| Template type | Current | Target |
|---|---|---|
| Official templates | `ai-system/official/agents` | Keep as canonical bundled templates |
| User templates | `ai-system/user/agents` | Keep as editable extension templates |
| Project-local templates | generated `.opencode/agents` projections | Keep as client-integration projection only |
| Versioning | implicit file state | add template manifest version + checksum |
| Seeding | `seedDatabase` + optional script | keep seed, add non-destructive upgrade policy |

**Upgrade strategy:**
- Preserve runtime agent customizations unless explicit `--apply-template-updates`.
- Track template revision in DB for drift detection.

### 7D. Permission and safety boundaries
- Enforce permission mapping consistently across all runners (not only CLI-based runners).
- Introduce stage-level permission minimums and deny dangerous actions by default.
- Add approval requirements for:
  - new high-risk custom agent activation
  - escalation to dangerous capabilities
  - budget override beyond hard limit.
- Budget checks should integrate with queue admission and step start, not only mid-worker.

---

## 8. Artifacts, logs, approvals, budgets

### Artifacts
- **Current equivalent:** `IssueWorkProduct` with `type/title/content/filePath`.
- **Target model:** `Artifact` with `artifactType`, `runId`, `stepRunId`, `mimeType`, `payloadRef`, `summary`, `createdByAgent`, `hash`.
- **Storage:** DB metadata + optional filesystem/blob storage reference.
- **Relations:** one-to-many from workflow run and step.
- **Export:** run-scoped export bundle with metadata + content.

### Logs
- **Live logs:** keep WS streaming.
- **Persisted logs:** add step log table (`pipeline_step_logs`).
- **Run-level logs:** derived stream across step logs.
- **Step-level logs:** ordered sequence with timestamps and chunk indexes.
- **Replayability:** required for Workflow Detail and `forge logs workflow`.
- **CLI/UI tail behavior:** WS for live + backfill from persisted logs.

### Approvals
- **Current:** basic `Approval` for hire/budget override.
- **Target types:** `stage_gate`, `budget_override`, `dangerous_capability`, `agent_change`, `release_gate`.
- **Lifecycle:** `pending -> approved/rejected/cancelled/expired`.
- **Workflow relation:** approval linked to run + step gate.
- **CLI/UI:** inbox with context, decision action, audit trail.

### Budgets
- **Current:** policy + usage exist; action semantics incomplete.
- **Target policy:** scope (`company/project/agent/workflow`), thresholds, action semantics.
- **Usage model:** aggregate by month + by run/step/agent.
- **Enforcement points:** queue admission, step start, optional preflight before intake acceptance.
- **Reporting surfaces:** Overview, Budget page, workflow detail cost panel.

### Needed schema/API increments
- Add run/step linkage fields to `cost_events`, `issue_work_products`, `approvals`.
- Add persisted log table.
- Add workflow artifact endpoints and approval inbox endpoints.
- Add consolidated runtime endpoint and queue pressure metrics endpoint.

---

## 9. Naming cleanup and compatibility strategy

### Canonical naming rules
- Product name: **Forge** only.
- Directory/config name: **`.forge`** only (primary).
- User-facing nouns: Work Item, Feature, Bug, Workflow, Run, Step.
- Internal persistence names (`Issue`, `PipelineRun`) remain until later migration.

### Internal vs external naming policy
- External API/CLI/UI: product-oriented terms.
- Internal DB/code: compatibility names allowed behind adapters.
- Add translation layer:
  - `Issue` -> `WorkItem`
  - `PipelineRun` -> `WorkflowRun`
  - `PipelineStepRun` -> `WorkflowStep`.

### Deprecation plan
- Phase 1: Introduce new terms + aliases; emit warnings for legacy commands/paths.
- Phase 2: Default docs/UI use new terms only.
- Phase 3: Telemetry and usage checks for remaining legacy usage.
- Phase 4: Sunset `.firm` fallback and remaining legacy labels.

### What should not be renamed yet
- Prisma model/table names for `issues`, `pipeline_runs`, `pipeline_step_runs`.
- Internal class names where rename would force broad migration without product gain.
- MCP tool names until downstream clients have compatibility window.

---

## 10. Target API / contract plan

### Endpoints to keep as-is (core execution spine)
- `POST /v1/intake/requests`
- `GET /v1/pipelines/:id`
- `GET /v1/pipelines/:id/steps`
- `POST /v1/pipelines/:id/cancel`
- `POST /v1/pipelines/:id/steps/:stepKey/retry`
- `GET/POST/PUT/DELETE /v1/agents...`
- `GET/POST /v1/approvals...` (extend semantics)
- `GET/POST /v1/budget...` (enforcement semantics upgrade)

### Wrap/aggregate (for product UX)
- Keep `issues` endpoints internally; add product-facing wrappers:
  - `/v1/work-items...`
  - `/v1/features...`
  - `/v1/bugs...`

### New aggregate endpoints
- `GET /v1/workflows?companyId=&projectId=&status=&type=&cursor=`
- `GET /v1/workflows/:id` (includes run summary + step projection + gate state + cost summary)
- `GET /v1/workflows/:id/artifacts`
- `GET /v1/workflows/:id/logs?stepKey=&cursor=`
- `GET /v1/approvals/inbox?companyId=&status=`
- `POST /v1/approvals/:id/actions` (`approve|reject|cancel`)
- `GET /v1/runtime` (health + queue pressure + worker state + scheduler state)
- `GET /v1/projects` + `POST /v1/context/switch` (workspace/project selection)

### Example payloads

```json
{
  "workflow": {
    "id": "prun_x",
    "type": "feature",
    "status": "running",
    "entryAgentSlug": "intake-gate",
    "currentStepKey": "builder",
    "progress": { "completed": 2, "total": 6 },
    "approvalState": "none",
    "cost": { "usd": 1.42, "tokens": 182340 }
  }
}
```

```json
{
  "artifacts": [
    {
      "id": "art_x",
      "runId": "prun_x",
      "stepKey": "architect",
      "artifactType": "architecture_plan",
      "title": "Architecture Plan",
      "createdAt": "2026-03-25T09:00:00Z"
    }
  ]
}
```

```json
{
  "approvals": [
    {
      "id": "app_x",
      "type": "stage_gate",
      "status": "pending",
      "runId": "prun_x",
      "stepKey": "devops",
      "requestedBy": "quality-guard",
      "requestedAt": "2026-03-25T09:10:00Z"
    }
  ]
}
```

### WebSocket event model (recommended)
- `workflow.run.updated`
- `workflow.step.updated`
- `workflow.step.log`
- `workflow.artifact.created`
- `approval.created|updated`
- `budget.updated|threshold`
- `runtime.health.updated`
- `queue.pressure.updated`

### CLI/runtime shared types
- Introduce `src/contracts/workflow.ts`, `approval.ts`, `artifact.ts`, `runtime.ts`.
- Reuse in server route responses, CLI formatters, MCP wrappers, and Web UI API clients.

---

## 11. Schema / data model evolution

### Existing support assessment

| Model | Current strength | Missing for target |
|---|---|---|
| `PipelineRun` | solid run identity + status | no workflow definition key/version, no approval summary fields |
| `PipelineStepRun` | step state + dependencies + attempts | no explicit retry policy snapshot, no structured output metadata |
| `Issue` | work-item core is usable | mixed status vocab; feature/bug surface wrappers missing |
| `IssueWorkProduct` | basic artifact-like store | no run/step linkage, weak typing, content blob only |
| `IssueComment` | usable log/comment stream | not step/run scoped |
| `Agent` | robust base config | no explicit capability profile/stage compatibility |
| `Approval` | basic approval record | no run/step scope fields, decision actor metadata minimal |
| `BudgetPolicy` / `CostEvent` | usable baseline | policy action semantics + run/step linkage missing |
| `ScheduledJob` | scheduler base exists | no generic automation metadata beyond heartbeat use |
| `SyncOutbox` | outbound event staging exists | no typed event contract/versioning fields |
| Logs persistence | partial via summaries | no dedicated step log table |

### Phase 1 minimal non-destructive additions
- `pipeline_runs`: add `workflowKey`, `workflowVersion`.
- `pipeline_step_runs`: add `retryPolicyJson`, `gateState`.
- `issue_work_products`: add nullable `pipelineRunId`, `pipelineStepRunId`, `artifactType`.
- `approvals`: add nullable `pipelineRunId`, `stepKey`, `reviewedBy`, `reason`.
- `cost_events`: add nullable `pipelineRunId`, `pipelineStepRunId`, `queueJobId`.

### Phase 2 medium additions
- New `workflow_definitions` table (key/version/stages JSON/active flag).
- New `workflow_run_artifacts` table (typed artifact registry).
- New `workflow_run_projections` (optional denormalized query view table).

### Phase 3 high-impact additions
- New `pipeline_step_logs` table (ordered persisted log chunks).
- New `agent_template_revisions` table or equivalent manifest model.
- New `approval_policies` table for stage-level/dangerous-capability gates.

### Leave untouched for now
- Core `issues`, `pipeline_runs`, `pipeline_step_runs` table identities.
- `queue_jobs` leasing mechanics.
- `sync_outbox` base flow unless cloud sync requirements expand.

---

## 12. Phased implementation roadmap

### Phase 1 — Product wrappers and surface clarity
- **Goals:** workflow-first CLI/API wrappers, naming aliases, minimal new read models.
- **Likely modules:** [src/cli/index.ts](/Users/halilozdemir/Desktop/claude-cli-bridge/v3/src/cli/index.ts), [src/cli/commands](/Users/halilozdemir/Desktop/claude-cli-bridge/v3/src/cli/commands), [src/server/routes/intake.ts](/Users/halilozdemir/Desktop/claude-cli-bridge/v3/src/server/routes/intake.ts), new workflow list route module.
- **Backend work:** add workflow list endpoint, approval inbox projection endpoint, artifact listing by run.
- **CLI work:** add `feature`, `bug`, `workflow` wrappers; legacy aliases + warnings.
- **Frontend work:** minimal nav labels and route placeholders for new pages.
- **Schema work:** minimal additive fields only if needed for projection.
- **Keep unchanged:** dispatcher/worker core, Fastify, Prisma, queue model.
- **Wrap vs rewrite:** wrap existing `issues`/`pipelines`; do not rewrite execution engine.
- **Risk:** low.
- **Impact:** immediate product language clarity and discoverability.
- **Sequence:** API projections first, CLI wrappers second, UI nav third.

### Phase 2 — Workflow OS Web UI
- **Goals:** workflows, workflow detail, approvals, artifacts, runtime pages; clear IA.
- **Likely modules:** [webui/src/router/router.ts](/Users/halilozdemir/Desktop/claude-cli-bridge/v3/webui/src/router/router.ts), [webui/src/components/layout/sidebar.ts](/Users/halilozdemir/Desktop/claude-cli-bridge/v3/webui/src/components/layout/sidebar.ts), new pages under `webui/src/components/pages`.
- **Backend work:** workflow detail aggregate, approvals inbox/actions, runtime aggregate.
- **Frontend work:** new pages + page interactions + context switcher.
- **Schema work:** likely none mandatory if projections use existing tables.
- **Keep unchanged:** static serving model and websocket transport.
- **Wrap vs rewrite:** evolve current vanilla TS app; no framework rewrite.
- **Risk:** medium.
- **Impact:** turns Web UI into real operations console.
- **Sequence:** Workflows list/detail -> approvals -> artifacts -> runtime -> settings.

### Phase 3 — Model hardening
- **Goals:** explicit workflow definition registry, typed artifacts, persisted step logs, custom agent validation.
- **Likely modules:** [src/orchestrator](/Users/halilozdemir/Desktop/claude-cli-bridge/v3/src/orchestrator), [src/server/routes](/Users/halilozdemir/Desktop/claude-cli-bridge/v3/src/server/routes), `prisma/schema.prisma`.
- **Backend work:** definition registry resolution, step log persistence pipeline, strict contract-aware stage outcome parsing.
- **CLI/UI work:** validation displays, artifact/log viewers with replay.
- **Schema work:** phase 2/3 additive models.
- **Keep unchanged:** base queue/worker leasing and provider runner abstraction.
- **Wrap vs rewrite:** incrementally enrich run/step models; avoid engine replacement.
- **Risk:** medium/high.
- **Impact:** converts “pipeline execution” into true workflow OS semantics.
- **Sequence:** schema -> backend ingestion -> API projections -> CLI/UI consumption.

### Phase 4 — Naming convergence and deeper cleanup
- **Goals:** `.firm` sunset, internal naming debt reduction, docs/telemetry-based deprecations.
- **Likely modules:** [src/utils/config.ts](/Users/halilozdemir/Desktop/claude-cli-bridge/v3/src/utils/config.ts), [src/utils/process.ts](/Users/halilozdemir/Desktop/claude-cli-bridge/v3/src/utils/process.ts), docs, CLI deprecation messages.
- **Backend/CLI/UI work:** remove legacy paths, finalize aliases, update naming surfaces.
- **Schema work:** none required.
- **Keep unchanged:** DB table names unless there is a strong ROI migration case.
- **Wrap vs rewrite:** deprecate and remove compatibility shims gradually.
- **Risk:** medium (operational compatibility).
- **Impact:** reduces confusion and support burden.
- **Sequence:** telemetry gate -> warn-only -> remove.

---

## 13. Implementation slices

### Slice 1
- **Scope:** Add workflow list endpoint + CLI `forge workflow list/show/watch` wrappers.
- **Likely files:** `src/server/routes/intake.ts` (or new `workflows.ts`), `src/cli/commands/workflow.ts`, `src/cli/index.ts`.
- **Why this size:** immediate workflow visibility without schema churn.
- **Acceptance criteria:** can list runs by status/type; show active step/progress; watch run updates.
- **Dependencies:** none.
- **Rollback risk:** low.
- **User-visible unlock:** users can operate runs explicitly instead of hunting through issues.

### Slice 2
- **Scope:** Feature/bug CLI wrappers over intake-first flow + legacy warning path on `issue run`.
- **Likely files:** `src/cli/commands/feature.ts`, `src/cli/commands/bug.ts`, `src/cli/commands/issue.ts`, `src/cli/index.ts`.
- **Why this size:** aligns user language with product while preserving compatibility.
- **Acceptance criteria:** `forge feature run` and `forge bug run` create intake request and return pipelineRunId; legacy command warns.
- **Dependencies:** Slice 1 preferred but not mandatory.
- **Rollback risk:** low.
- **User-visible unlock:** first-class workflow entrypoints.

### Slice 3
- **Scope:** Approval inbox aggregate API + web approvals page + CLI inbox action parity.
- **Likely files:** `src/server/routes/approvals.ts`, new web page/api modules, `src/cli/commands/approval.ts`.
- **Why this size:** closes key operational gap without touching core execution engine.
- **Acceptance criteria:** pending approvals visible with context; approve/reject reflected in run state.
- **Dependencies:** none.
- **Rollback risk:** low/medium.
- **User-visible unlock:** gated execution becomes operable in UI and CLI.

### Slice 4
- **Scope:** Workflow Detail page (steps, current status, retry/cancel controls) using existing pipeline endpoints.
- **Likely files:** new `webui/src/components/pages/workflow-detail.ts`, router/nav updates, web API client additions.
- **Why this size:** highest value operational page using existing backend contracts.
- **Acceptance criteria:** open run detail from list; display ordered steps; execute retry/cancel actions.
- **Dependencies:** Slice 1.
- **Rollback risk:** low.
- **User-visible unlock:** inspectable workflow execution lifecycle.

### Slice 5
- **Scope:** Typed artifacts + persisted step logs foundations (schema + ingestion + read APIs).
- **Likely files:** `prisma/schema.prisma`, `src/bridge/worker.ts`, `src/orchestrator/dispatcher.ts`, new routes for artifacts/logs.
- **Why this size:** strategic hardening slice; introduces durable observability.
- **Acceptance criteria:** each completed step has typed artifact references; logs replayable per run/step.
- **Dependencies:** slices 1–4 beneficial.
- **Rollback risk:** medium.
- **User-visible unlock:** reliable artifact/log operations and auditability.

---

## 14. What should not be changed yet

| Component | Keep for now | Premature rewrite risk |
|---|---|---|
| Fastify server | Already central and integrated with WS + static UI | Route churn and integration breakage |
| Prisma + SQLite | Working operational SoT; easy local setup | Migration complexity and reliability regressions |
| Queue/worker architecture | Existing bounded job model with retries/leases | Rebuilding scheduler/execution introduces instability |
| Dispatcher core | Current run/step state machine is viable base | Losing execution continuity semantics |
| Provider runner abstraction | Already decouples model providers | Tight-coupling runtime to one provider |
| MCP integration shape | Already productive for external AI tools | Client compatibility breaks |
| `forge init` | Onboarding anchor command | Setup friction and migration burden |
| `forge start` | Runtime boot anchor | Operational confusion and support cost |

---

## 15. Final recommendation

1. **What Forge really is today:**  
Forge is already a local AI workflow runtime with a real execution spine (`intake` + `pipeline_runs` + `pipeline_step_runs` + `queue_jobs` + workers), plus CLI/UI/MCP surfaces around it. It is not just a chat wrapper.

2. **What Forge should become next:**  
A workflow-first AI operations system where Feature/Bug workflows, run inspection, approvals, artifacts, logs, and budget policy are first-class product objects with stable contracts.

3. **Single most important implementation sequence:**  
Add workflow-centric read/control surfaces first (workflow list/detail/watch + approvals inbox) before deep model refactors. This unlocks product coherence immediately while preserving runtime stability.

4. **Biggest strategic mistake to avoid:**  
Rewriting the runtime core now. The real gap is product contract/surface coherence and typed operational objects, not the need for a new engine.

5. **Build order (first, second, third):**  
First: CLI/API workflow wrappers and run projections.  
Second: Web UI workflow/approval/runtime pages with coherent IA.  
Third: Model hardening (definition registry, typed artifacts, persisted logs, stronger custom-agent validation).

