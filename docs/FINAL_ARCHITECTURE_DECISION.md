# Forge V2.1 – Final Architecture Decision

**Status:** LOCKED
**Date:** 2026-03-25
**Authors:** Architecture Review
**Target:** Production pilot

---

## 1. Core Principles

- Forge is a runtime-centered workflow OS, not a chat system. The harness controls all transitions. Agents execute; they do not coordinate.
- All agent-to-agent communication is forbidden. All state passes through the harness via typed artifacts.
- Context is assembled per step by the harness. Agents do not accumulate conversation history.
- The evaluator is permanently partially reliable. It is authoritative only for machine-verifiable criteria. It is never trusted for subjective, qualitative, or experiential judgment.
- Human review is a first-class execution path, not a fallback. Approval gates are expected on every sprint that contains required human-verifiable criteria.
- Auto-retry is disabled until evaluator calibration is demonstrated through manual inspection of real traces. Enabling it is a future operational decision, not an architectural one.
- V1 primitives are preserved. This migration is additive. Nothing in V1 is removed or replaced.
- Complexity is only added when the alternative is a known, concrete production failure.

---

## 2. System Overview

### Planner
Runs once per pipeline. Expands a user prompt into a `ProductSpec` containing features and a sprint breakdown. Does not write code. Does not specify implementation details. Emits a schema-validated `ProductSpec` artifact. After completion, the harness reads the sprint list and dynamically injects sprint steps into the pipeline.

### Builder
Runs once per sprint in the contract phase, and once or more in the build phase. In the contract phase, proposes a `SprintContract` defining scope, exclusions, and testable criteria. In the build phase, implements the sprint against the approved contract, commits code, and emits a `BuildResult` with a real git commit SHA.

### Evaluator
Runs twice per sprint: once to review the proposed `SprintContract`, and once to verify the `BuildResult` against the approved contract. In contract review, it approves or rejects the contract. In verification, it is authoritative for machine-verifiable criteria only. For human-verifiable criteria, it records a one-sentence observation and assigns `pending_human_review`. It never judges human criteria.

### Harness (PipelineDispatcher)
Owns all state transitions. Assembles context for each step. Validates artifact schemas before storing. Resolves sprint outcomes from `EvaluationReport` content. Triggers approval gates. Enforces retry limits via existing `loopsBackTo` and `maxRevisions`. The harness makes every structural decision; agents have no visibility into pipeline state.

### SprintRun
The harness's authoritative ledger for each sprint loop iteration. One row per sprint per pipeline. Tracks `status`, `approvalReason`, `contractRevisions`, and `buildAttempts`. The harness reads `SprintRun` to determine where a pipeline is in its sprint loop. `PipelineStepRun` tracks individual step execution; `SprintRun` tracks the sprint-level lifecycle.

---

## 3. Artifact Model

All artifacts are stored in `IssueWorkProduct.structuredPayload` (type `Json`) with `IssueWorkProduct.artifactType` as the schema discriminant and `IssueWorkProduct.schemaVersion` as the version tag.

`resultSummary` on `PipelineStepRun` remains as a human-readable log only. It is never parsed by the harness.

---

### 3.1 ProductSpec

**Purpose:** The Planner's output. Defines what will be built and how the work is divided into sprints. Read-only for all downstream agents.

**Schema:**
```typescript
type ProductSpec = {
  title: string
  summary: string                // 2–4 sentences, user-facing description
  features: {
    id: string                   // e.g. "feat-1"
    title: string
    description: string
  }[]
  constraints: string[]          // technical, scope, or timeline constraints
  sprints: {
    number: number               // sequential from 1
    goal: string
    featureIds: string[]         // references features[].id
  }[]                            // min 1, max 5
}
```

**Validity rule:** `sprints[].featureIds` must reference valid `features[].id` values. Harness rejects on schema validation failure.

---

### 3.2 SprintContract

**Purpose:** The shared oracle for a sprint. Proposed by Builder, approved by Evaluator before any code is written. Defines what "done" means for this sprint. Once approved, it is immutable for the duration of the sprint's build and evaluation.

**Schema:**
```typescript
type Criterion = {
  id: string                    // e.g. "cr-1", unique within contract
  description: string           // min 10 chars; must be phrased as an answerable question or observable outcome
  verifierType: "machine" | "human"
  verificationMethod?:          // present if and only if verifierType = "machine"
    "playwright" | "lint" | "test-run" | "file-check"
  required: boolean
}

type SprintContract = {
  sprintNumber: number
  goal: string
  scope: string[]               // what will be built
  outOfScope: string[]          // explicit exclusions; must be non-empty
  criteria: Criterion[]
  contractStatus: "proposed" | "revised" | "approved" | "rejected"
  revisionNumber: number        // 0 on first proposal, increments on each revision
  proposedBy: "builder"
  approvedBy?: "evaluator"      // present only when contractStatus = "approved"
}
```

**Validity rules — all enforced at schema validation time, not at evaluation time:**

| Rule | Enforcement |
|---|---|
| `verifierType = "machine"` requires `verificationMethod` | Zod `.refine()` |
| `verifierType = "human"` forbids `verificationMethod` | Zod `.refine()` |
| At least one `required: true` criterion must exist | Zod `.refine()` |
| At least one `required: true, verifierType: "machine"` criterion must exist | Zod `.refine()` |
| `outOfScope` must be non-empty | `z.array(z.string()).min(1)` |
| `description` minimum 10 characters | `z.string().min(10)` |

**Forbidden combinations:**
- A contract with zero required criteria.
- A contract with zero required machine criteria.
- A machine criterion without `verificationMethod`.
- A human criterion with `verificationMethod`.

---

### 3.3 BuildResult

**Purpose:** The Builder's output after implementing a sprint. Contains a real git reference that the Evaluator must test against. Immutable once emitted.

**Schema:**
```typescript
type BuildResult = {
  sprintNumber: number
  contractRef: string           // IssueWorkProduct.id of the approved SprintContract
  summary: string               // what was built, plain text
  filesChanged: string[]        // actual file paths modified or created
  gitRef: string                // real commit SHA; harness verifies this exists before dispatching evaluator
  attemptNumber: number         // 1 on first attempt, increments on retry
  selfAssessment: string        // builder's brief self-assessment; informational only, not evaluated
}
```

---

### 3.4 EvaluationReport

**Purpose:** The Evaluator's output after verifying a sprint. Reflects the machine/human split explicitly. The harness reads `machinePassed` and `requiresHumanReview` to determine sprint outcome. `overallPassed` is not used.

**Schema:**
```typescript
type CriterionResult = {
  id: string
  status: "passed" | "failed" | "not_verifiable" | "pending_human_review"
  evidence: string              // required for all statuses, including pending_human_review
  toolsUsed?: string[]          // required when status = passed | failed | not_verifiable
  failureReason?: string        // required when status = failed
  observationNote?: string      // used when status = pending_human_review; one sentence only
}

type EvaluationReport = {
  sprintNumber: number
  contractRef: string           // IssueWorkProduct.id of the approved SprintContract
  gitRefTested: string          // must match BuildResult.gitRef
  criteria: CriterionResult[]   // one entry per criterion in the SprintContract; no omissions
  machinePassed: boolean        // true if all required machine criteria have status = "passed"
  requiresHumanReview: boolean  // true if any required human criteria exist in the contract
  blockers: string[]            // criterion ids: required machine criteria with status = "failed"
  notVerifiableMachineRequired: string[]  // required machine criteria with status = "not_verifiable"
  recommendations: string
}
```

**`status` semantics:**
- `passed`: machine criterion, tool evidence confirms passing.
- `failed`: machine criterion, tool evidence confirms failure.
- `not_verifiable`: machine criterion, evaluator's tools were structurally insufficient to test it.
- `pending_human_review`: human criterion, always. Not a failure. Not an exception. Expected.

**Harness pre-acceptance checks on EvaluationReport (deterministic, not prompt-level):**
1. `gitRefTested` must equal `BuildResult.gitRef`. If not: step rejected, evaluator re-queued.
2. Every criterion in the SprintContract must appear in `criteria[]` with no omissions.
3. Every criterion with `status = passed | failed | not_verifiable` must have non-empty `toolsUsed`.
4. `machinePassed` must be `false` if `blockers.length > 0`. Schema-level invariant.
5. `requiresHumanReview` must be `true` if any required human criteria exist in the contract.

If any check fails: the step is rejected with a structured error message. The evaluator is re-queued once with the rejection reason. If it fails again: `approval_pending(evaluation_failure)`.

---

## 4. Sprint Execution Model

### Pipeline initialization

```
User prompt
  → Planner step runs
  → Emits ProductSpec artifact
  → Harness calls appendSprintSteps(pipelineRunId, productSpec)
  → For each sprint in productSpec.sprints[]:
      Creates PipelineStepRun rows: sprint-N-contract, sprint-N-contract-review,
                                     sprint-N-build, sprint-N-evaluate
      Creates SprintRun row: { pipelineRunId, sprintNumber: N, status: "contracting" }
  → Updates PipelineRun.planJson with full expanded step list
  → Enqueues sprint-1-contract (only eligible step)
```

### Per-sprint execution

```
sprint-N-contract        (Builder proposes SprintContract)
  dependsOn: ["planner"] for N=1, ["sprint-(N-1)-evaluate"] for N>1
  loopsBackTo: sprint-N-contract
  maxRevisions: 2

sprint-N-contract-review (Evaluator approves or rejects)
  dependsOn: ["sprint-N-contract"]
  loopsBackTo: sprint-N-contract
  maxRevisions: 2
  On APPROVED: SprintRun.status → "building", advance to sprint-N-build
  On REJECTED: loop back to sprint-N-contract with rejection feedback
  On revision limit exhausted: SprintRun.status → "approval_pending",
                               SprintRun.approvalReason → "contract_revision_limit"

sprint-N-build           (Builder implements)
  dependsOn: ["sprint-N-contract-review"]
  maxRevisions: 3
  On completion: harness verifies gitRef exists in workspace before dispatching evaluator

sprint-N-evaluate        (Evaluator verifies)
  dependsOn: ["sprint-N-build"]
  On completion: harness runs sprint outcome rules (Section 6)
  On RETRY: loop back to sprint-N-build with EvaluationReport.blockers as feedback
  On build retry limit exhausted: SprintRun.status → "approval_pending",
                                  SprintRun.approvalReason → "build_retry_limit"
```

### Retry behavior

Auto-retry is **OFF**. `HARNESS_AUTO_RETRY=false` is the default and will not be changed during the pilot.

With auto-retry OFF:
- On `blockers.length > 0`: the step fails and the harness creates an approval gate rather than automatically looping. The human decides whether to retry.
- The `loopsBackTo` primitive remains in the schema and dispatcher for future use. It is not removed. It is not triggered automatically.

This means every sprint failure, every contract rejection, and every evaluation failure requires human input to continue. This is intentional. The system cannot be trusted to loop autonomously until evaluator calibration is proven.

---

## 5. Evaluation Model

### What the evaluator does for machine criteria

- Calls at least one tool per criterion before assigning any status.
- Assigns `passed` only with direct tool evidence, not plausible inference.
- Assigns `failed` with specific `failureReason` and `toolsUsed`.
- Assigns `not_verifiable` when tools are structurally insufficient (e.g., cannot access auth-gated features, cannot test audio output). This is permitted but must include an explanation in `evidence`.
- Never assigns `passed` to a criterion it did not test.

**Available tools:** Playwright MCP (raw), file read (workspace-scoped), test runner (structured output), git log/diff. Tools are not wrapped in custom abstractions for the pilot.

### What the evaluator does for human criteria

- Writes one sentence of factual observation in `observationNote` (what was seen, not a judgment).
- Sets `status: "pending_human_review"`.
- Does not call any tools for human criteria.
- Does not assign `passed` or `failed` to human criteria under any circumstances.

### What the evaluator is not trusted for

- Judging UX quality, visual polish, or design coherence.
- Assessing feature completeness as experienced by a user.
- Evaluating correctness of complex multi-step user flows beyond what a single Playwright session can deterministically verify.
- Any subjective criterion.

These are not evaluator failures. These are structural limits. The architecture accounts for them by routing human criteria to approval.

---

## 6. Sprint Outcome Rules

These rules are evaluated deterministically by the harness after the `sprint-N-evaluate` step completes. They are not evaluated by any agent.

```
LET report = validated EvaluationReport for sprint N
LET machine_required_failed   = report.blockers.length > 0
LET machine_required_blocked  = report.notVerifiableMachineRequired.length > 0
LET machine_passed            = report.machinePassed
LET requires_human            = report.requiresHumanReview

RULES (evaluated in order; first match wins):

1. machine_required_failed = true
   → SprintRun.status = "failed" (if attempts < maxRevisions)
   → action: loopsBackTo sprint-N-build with blockers as builder feedback
   → if attempts >= maxRevisions:
       SprintRun.status = "approval_pending"
       SprintRun.approvalReason = "build_retry_limit"

2. machine_required_blocked = true (and machine_required_failed = false)
   → SprintRun.status = "approval_pending"
   → SprintRun.approvalReason = "not_verifiable_required_machine"

3. machine_passed = true AND requires_human = true
   → SprintRun.status = "approval_pending"
   → SprintRun.approvalReason = "human_review_required"
   → THIS IS THE NORMAL PATH for sprints with human criteria

4. machine_passed = true AND requires_human = false
   → SprintRun.status = "passed"
   → Pipeline advances to sprint-(N+1)-contract or COMPLETE if last sprint
```

**Invariants enforced before this decision tree runs:**
- If `machinePassed = true` and `blockers.length > 0`: schema validation error, evaluator step rejected.
- If `requiresHumanReview = false` and any required human criteria have `pending_human_review` status: schema validation error, evaluator step rejected.

---

## 7. Approval Flow

### Trigger conditions

| approvalReason | Trigger |
|---|---|
| `human_review_required` | Machine criteria passed; required human criteria exist |
| `not_verifiable_required_machine` | Required machine criterion could not be verified by tools |
| `build_retry_limit` | Builder exhausted `maxRevisions` without passing machine evaluation |
| `contract_revision_limit` | Contract negotiation exhausted `maxRevisions` without approval |
| `evaluation_failure` | Evaluator step failed harness pre-acceptance checks twice |

### What the human sees

The approval payload surfaced in Web UI and CLI:

```
Sprint N: [goal]
Reason: [approvalReason — human-readable label]

MACHINE EVALUATION
──────────────────
[criterion id] [description]
  Status:    passed / failed / not_verifiable
  Evidence:  [evidence string]
  Tools:     [toolsUsed]

HUMAN REVIEW REQUIRED
──────────────────────
[criterion id] [description]
  Observation: [evaluator's one-sentence observation]

BUILD SUMMARY
─────────────
[BuildResult.summary]
Files changed: [BuildResult.filesChanged]
Git ref: [BuildResult.gitRef]
[Workspace URL if available]
```

### Allowed actions

**`approve_continue`**
Accepts all human criteria as-is. Sprint transitions to `passed`. Pipeline advances to next sprint or `COMPLETE`.

**`approve_with_notes(notes: string)`**
Accepts sprint with feedback. Sprint transitions to `passed`. The `notes` string is injected into the next sprint's builder context as:
`"Human reviewer approved sprint N with the following feedback: {notes}"`
This is the only mechanism for passing human judgment forward into the pipeline.

**`reject_and_retry(feedback: { criterionId: string, reason: string }[])`**
Sprint transitions back to `building`. Each `feedback` entry is injected into the builder's retry context alongside the criterion description. Builder receives the list of failed human criteria and the human's reason for each. This counts as a build attempt against `SprintRun.buildAttempts`.

**`skip_criterion(criterionId: string, reason: string)`**
Marks a specific human criterion as not applicable. Criterion is removed from active evaluation for this sprint. Sprint is re-evaluated against remaining criteria. Requires a `reason` string for audit. Permitted for human criteria only. Machine criteria cannot be skipped.

### Effect on state

All approval actions write to `SprintRun` and advance `PipelineRun.currentStepKey`. The approval record (action, actor, timestamp, payload) is stored in the existing approvals table. No new tables required.

---

## 8. Context Model

The harness assembles a per-step context bundle before dispatch. Agents do not see accumulated conversation history.

### Builder receives

```
1. Role system prompt (static, builder-specific)
2. ProductSpec — title + sprint list + constraints only (not full feature descriptions)
3. Current SprintContract — full, if approved
4. Sprint history from SprintRun — harness-generated block:
     "Completed sprints: [N, ...] | Current sprint: N"
     Derived from SprintRun.status = 'passed' records. Not a file. Not builder-written.
5. Retry feedback — ONLY if attempt > 1:
     For build retry: EvaluationReport.blockers with evidence
     For human rejection: feedback[].reason per criterion
```

**Explicitly not included:** resultSummary from any prior step. Full feature list from ProductSpec. Prior sprint EvaluationReports. Builder self-assessments from prior attempts.

### Evaluator receives

```
1. Role system prompt (static, evaluator-specific)
2. Current SprintContract — full (the oracle)
3. BuildResult — summary, filesChanged, gitRef
4. Git diff — harness-generated: git diff from sprint start ref to BuildResult.gitRef
```

**Explicitly not included:** Prior EvaluationReports. Builder self-assessment. ProductSpec. Sprint history. Any context from steps outside the current sprint.

### Rule

No step receives resultSummary injections from prior steps. The dispatcher's `enqueueStepRun` method removes the current V1 behavior of appending all prior step outputs. This is the single most impactful context change in V2.1.

---

## 9. What Is Explicitly Out of Scope

The following are not part of Forge V2.1 and will not be built:

**Bootstrap/init phase:** A dedicated workspace initialization step (init.sh, initial git commit). Not required for a 1–2 sprint pilot. Revisit when multi-sprint production workloads are validated.

**Progress file:** A `forge-progress.json` committed to the workspace by agents. Sprint history is served from `SprintRun` DB records by the harness. No file-based progress tracking.

**Task-shaped tool wrappers:** Custom wrappers around Playwright, git, or test runners. Raw tools are used for the pilot. Wrappers are added only if raw tools produce demonstrably identifiable bad patterns in real traces.

**Auto-retry:** The `loopsBackTo` primitive exists in the schema and dispatcher but is not triggered automatically. `HARNESS_AUTO_RETRY=false`. This will not change during the pilot.

**Code execution with MCP:** The token-efficiency optimization described in the Anthropic engineering post. Not Phase 1. Not Phase 2. Revisit when evaluator tool call volume exceeds 15+ calls per sprint.

**Retrospective analytics:** Post-pipeline LLM-generated learning reports. No traces exist yet to learn from. Build after 20+ completed pipeline runs.

**Separate Architect role:** SprintContract is the architecture artifact at the correct specificity. An additional Architect role produces un-testable planning documents. It is not added.

---

## 10. Implementation Scope

Exactly the following will be built:

### `src/orchestrator/artifacts.ts` (new file)
Zod schemas for all four artifacts: `ProductSpecSchema`, `SprintContractSchema`, `BuildResultSchema`, `EvaluationReportSchema`. All validation rules including cross-field refinements. Type exports. Schema registry map `ARTIFACT_SCHEMAS`. No other logic in this file.

### Prisma schema changes
**`IssueWorkProduct`:** Add `structuredPayload Json?` and `schemaVersion String?`.

**`SprintRun` (new model):**
```prisma
model SprintRun {
  id                         String    @id @default(cuid())
  pipelineRunId              String
  sprintNumber               Int
  status                     String    @default("contracting")
  approvalReason             String?
  contractRevisions          Int       @default(0)
  buildAttempts              Int       @default(0)
  contractArtifactId         String?
  evaluationArtifactId       String?
  createdAt                  DateTime  @default(now())
  completedAt                DateTime?

  pipelineRun PipelineRun @relation(fields: [pipelineRunId], references: [id], onDelete: Cascade)

  @@unique([pipelineRunId, sprintNumber])
  @@index([pipelineRunId, status])
  @@map("sprint_runs")
}
```
Add `sprintRuns SprintRun[]` relation to `PipelineRun`.

### `src/orchestrator/dispatcher.ts` changes
- `extractStructuredArtifact(output: string)`: parses last JSON block containing `artifactType` from agent output.
- `validateAndStoreArtifact(artifact, context)`: validates against schema registry, writes to `IssueWorkProduct.structuredPayload`.
- `appendSprintSteps(pipelineRunId, spec)`: generates sprint step DAG from `ProductSpec.sprints[]`, creates `PipelineStepRun` and `SprintRun` rows, updates `PipelineRun.planJson`, calls `enqueueEligibleSteps`.
- `resolveSprintOutcome(report)`: deterministic decision function implementing Section 6 rules.
- `handleApprovalDecision(sprintRunId, action, payload)`: handles four approval actions, updates `SprintRun`, injects feedback into next step context where applicable.
- `assembleStepContext(stepKey, pipelineRunId)`: replaces current resultSummary injection. Implements Section 8 context rules per step type.
- Hook in `handleStepSuccess()`: after `planner` completes → call `appendSprintSteps`. After `sprint-N-evaluate` completes → call `resolveSprintOutcome`.
- Harness pre-acceptance checks for `EvaluationReport`: run after `sprint-N-evaluate`, before advancing state.

### Agent prompts
Planner, Builder (contract phase), Builder (build phase), Evaluator (contract review), Evaluator (verification). Each prompt is a versioned string constant in its own file under `src/orchestrator/prompts/`. Prompt files are treated as versioned artifacts. Changes require manual trace validation before deployment.

### Evaluator tool access
Playwright MCP (raw), file read tool (workspace-scoped), test runner tool (structured output), git diff tool. No custom wrappers. Tools are wired to the evaluator agent configuration.

### `src/orchestrator/pipelines/harness.ts` (new file)
`buildHarnessPipeline()` (planner step only). `buildSprintSteps(spec, sprintDef)` (sprint step DAG generator). Register `harness` case in `FirmOrchestrator.buildPipeline()`.

---

## 11. Known Limitations

**The evaluator is not reliable for human criteria and never will be.** This is not a calibration problem. It is a structural constraint. Every sprint with required human criteria will reach `approval_pending(human_review_required)`. This is expected and by design. The system is not autonomous; it is human-supervised.

**Approval fatigue is a real and unmitigated risk.** If sprints consistently trigger human review, reviewers will rubber-stamp criteria without reading them. The architecture does not prevent this. It is mitigated only by the quality of human criteria descriptions in SprintContracts and the usability of the approval UI. Both are outside the scope of this document.

**Evaluator prompt calibration is iterative and will not be complete at pilot launch.** The first 5–10 evaluation traces will contain false positives (evaluator passing criteria it did not properly test) and false negatives (evaluator failing criteria due to tool misuse). Manual log inspection after every pilot run is mandatory. The evaluator prompt is a living artifact. Treat it accordingly.

**The harness pre-acceptance checks parse LLM output.** `extractStructuredArtifact` finds JSON blocks in agent output. LLM output format drifts across model versions. These checks will break when models change and will require maintenance. This is a known ongoing cost.

**`not_verifiable` on a required machine criterion always produces a human gate.** There is no mechanism to resolve this automatically. If the evaluator structurally cannot test a machine criterion (e.g., auth-gated, audio, visual rendering), a human must intervene. For workloads with many such criteria, the system will require proportionally more human involvement.

**The dynamic sprint count is capped at 5.** `ProductSpec.sprints` is `max(5)` by schema. This is not a technical limit; it is a pilot scope limit. Multi-sprint coherence beyond 5 sprints requires the bootstrap/init phase, which is out of scope.

**V1 pipelines are unchanged.** Feature, bugfix, refactor, and release pipelines continue to operate as-is. The `harness` type is opt-in. Migration of V1 pipelines to V2.1 is not planned during the pilot.
