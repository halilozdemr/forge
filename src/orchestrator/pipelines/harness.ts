import type { PipelineStep } from "../index.js";

/**
 * Forge V2.1 – Harness pipeline skeleton.
 *
 * The initial plan contains the planner step plus sprint-1 steps only.
 * Steps for sprints 2-N are dynamically injected by appendSprintSteps (a later step)
 * after the planner emits a validated ProductSpec artifact.
 *
 * Static step sequence emitted here:
 *   planner
 *     → sprint-1-contract         (builder proposes SprintContract)
 *     → sprint-1-contract-review  (evaluator approves or rejects; loops back to contract on REJECTED)
 *     → sprint-1-build            (builder implements against approved contract)
 *     → sprint-1-evaluate         (evaluator verifies BuildResult against contract)
 */

/**
 * Build the four pipeline steps for a single sprint.
 *
 * @param sprintNumber  1-based sprint index
 * @param firstDependsOn  stepKey that contract depends on ("planner" for sprint 1,
 *                        "sprint-N-1-evaluate" for subsequent sprints)
 * @param opts  issue title/description for stub input context
 */
export function buildSprintSteps(
  sprintNumber: number,
  firstDependsOn: string,
  opts: { title: string; description?: string },
): PipelineStep[] {
  const context = `Sprint ${sprintNumber}: "${opts.title}"\n${opts.description ?? ""}`;
  const contractKey = `sprint-${sprintNumber}-contract`;
  const contractReviewKey = `sprint-${sprintNumber}-contract-review`;
  const buildKey = `sprint-${sprintNumber}-build`;
  const evaluateKey = `sprint-${sprintNumber}-evaluate`;

  return [
    {
      key: contractKey,
      agentSlug: "harness-builder",
      input: `Propose a SprintContract for sprint ${sprintNumber}. You are in contract phase (Mode 1). Emit a SprintContract artifact.\n\n${context}`,
      dependsOn: [firstDependsOn],
      loopsBackTo: contractKey,
      maxRevisions: 2,
    },
    {
      key: contractReviewKey,
      agentSlug: "evaluator",
      input: `Review the proposed SprintContract for sprint ${sprintNumber}. You are in contract review mode (Mode 1). Output {"decision":"APPROVED"} or {"decision":"REJECTED","issues":[...]}.\n\n${context}`,
      dependsOn: [contractKey],
      loopsBackTo: contractKey,
      maxRevisions: 2,
    },
    {
      key: buildKey,
      agentSlug: "harness-builder",
      input: `Implement sprint ${sprintNumber} against the approved SprintContract. You are in build phase (Mode 2). Commit your code and emit a BuildResult artifact with the real git commit SHA.\n\n${context}`,
      dependsOn: [contractReviewKey],
      maxRevisions: 3,
    },
    {
      key: evaluateKey,
      agentSlug: "evaluator",
      input: `Verify the BuildResult for sprint ${sprintNumber} against the approved SprintContract. You are in build verification mode (Mode 2). Emit an EvaluationReport artifact.\n\n${context}`,
      dependsOn: [buildKey],
    },
  ];
}

/**
 * Build the full harness pipeline plan.
 *
 * Returns the planner step and static sprint-1 steps. The harness dispatcher
 * will append steps for sprints 2-N after the planner completes.
 */
export function buildHarnessPipeline(opts: {
  issueId: string;
  title: string;
  description?: string;
}): PipelineStep[] {
  const context = `"${opts.title}"\n${opts.description ?? ""}`;

  const plannerStep: PipelineStep = {
    key: "planner",
    agentSlug: "planner",
    input: `Expand the request into a ProductSpec with a feature list and sprint breakdown. Emit a schema-validated ProductSpec artifact.\n\n${context}`,
    dependsOn: [],
  };

  // Sprint-1 is seeded statically. Sprints 2-N are injected dynamically
  // by appendSprintSteps after the planner step completes (implemented in a later step).
  const sprint1Steps = buildSprintSteps(1, "planner", opts);

  return [plannerStep, ...sprint1Steps];
}
