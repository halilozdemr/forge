import type { PipelineStep } from "../index.js";

/**
 * Bug pipeline:
 * Approved brief → Debugger → Reviewer → DevOps(hotfix commit)
 */
export function buildBugfixPipeline(opts: {
  issueId: string;
  title: string;
  description?: string;
}): PipelineStep[] {
  const context = `Bug: "${opts.title}"\n${opts.description ?? ""}`;

  return [
    {
      key: "debugger",
      agentSlug: "debugger",
      input: `Bug report already approved by the client.\n\n${context}\n\nPerform root cause analysis. Read the codebase, identify the source, document findings in .forge/memory/problems.md, and implement the minimum safe fix.`,
      dependsOn: [],
    },
    {
      key: "reviewer",
      agentSlug: "reviewer",
      input: `Bug fix implemented.\n\n${context}\n\nReview the fix for correctness and regressions. Confirm the bug is resolved.`,
      dependsOn: ["debugger"],
    },
    {
      key: "devops",
      agentSlug: "devops",
      input: `Bug fix reviewed and approved.\n\n${context}\n\nCommit with a "fix:" conventional commit message. Merge the hotfix branch if applicable.`,
      dependsOn: ["reviewer"],
    },
  ];
}
