import type { PipelineStep } from "../index.js";

/**
 * Refactor pipeline:
 * Approved brief → Architect → Builder → Reviewer → DevOps(commit)
 */
export function buildRefactorPipeline(opts: {
  issueId: string;
  title: string;
  description?: string;
}): PipelineStep[] {
  const context = `Refactor: "${opts.title}"\n${opts.description ?? ""}`;

  return [
    {
      key: "architect",
      agentSlug: "architect",
      input: `Refactor brief already approved by the client.\n\n${context}\n\nDesign the refactoring plan. Ensure backward compatibility. Document the decision in .forge/memory/decisions.md.`,
      dependsOn: [],
    },
    {
      key: "builder",
      agentSlug: "builder",
      input: `Architect has created the refactoring plan.\n\n${context}\n\nImplement the refactor. Follow the plan precisely. Do not introduce new features.`,
      dependsOn: ["architect"],
    },
    {
      key: "reviewer",
      agentSlug: "reviewer",
      input: `Refactor implemented.\n\n${context}\n\nReview for correctness, no unintended behavior changes, and adherence to the architect's plan.`,
      dependsOn: ["builder"],
    },
    {
      key: "devops",
      agentSlug: "devops",
      input: `Refactor reviewed and approved.\n\n${context}\n\nCommit with a "refactor:" conventional commit message.`,
      dependsOn: ["reviewer"],
    },
  ];
}
