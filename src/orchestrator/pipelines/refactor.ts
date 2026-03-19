import type { PipelineStep } from "../index.js";

/**
 * Refactor pipeline:
 * CEO → Architect → Engineer → Reviewer → DevOps(commit)
 */
export function buildRefactorPipeline(opts: {
  issueId: string;
  title: string;
  description?: string;
}): PipelineStep[] {
  const context = `Refactor: "${opts.title}"\n${opts.description ?? ""}`;

  return [
    {
      agentSlug: "ceo",
      input: `Refactor request received.\n\n${context}\n\nEvaluate the scope and risk. Approve or reject, then hand off to the architect.`,
      dependsOn: [],
    },
    {
      agentSlug: "architect",
      input: `Refactor approved.\n\n${context}\n\nDesign the refactoring plan. Ensure backward compatibility. Document the decision in .forge/memory/decisions.md.`,
      dependsOn: ["ceo"],
    },
    {
      agentSlug: "engineer",
      input: `Architect has created the refactoring plan.\n\n${context}\n\nImplement the refactor. Follow the plan precisely. Do not introduce new features.`,
      dependsOn: ["architect"],
    },
    {
      agentSlug: "reviewer",
      input: `Refactor implemented.\n\n${context}\n\nReview for correctness, no unintended behavior changes, and adherence to the architect's plan.`,
      dependsOn: ["engineer"],
    },
    {
      agentSlug: "devops",
      input: `Refactor reviewed and approved.\n\n${context}\n\nCommit with a "refactor:" conventional commit message.`,
      dependsOn: ["reviewer"],
    },
  ];
}
