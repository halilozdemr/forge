import type { PipelineStep } from "../index.js";

/**
 * Bug pipeline:
 * CEO → Debugger → Engineer → Reviewer → DevOps(hotfix commit)
 */
export function buildBugfixPipeline(opts: {
  issueId: string;
  title: string;
  description?: string;
}): PipelineStep[] {
  const context = `Bug: "${opts.title}"\n${opts.description ?? ""}`;

  return [
    {
      agentSlug: "ceo",
      input: `Bug report received.\n\n${context}\n\nAssess severity, decide if hotfix is needed immediately, and hand off to the debugger.`,
      dependsOn: [],
    },
    {
      agentSlug: "debugger",
      input: `Bug confirmed by CEO.\n\n${context}\n\nPerform root cause analysis. Read the codebase, identify the source, document findings in .forge/memory/problems.md, then propose a fix.`,
      dependsOn: ["ceo"],
    },
    {
      agentSlug: "engineer",
      input: `Debugger has identified the root cause.\n\n${context}\n\nImplement the fix based on the debugger's analysis. Keep the change minimal and focused.`,
      dependsOn: ["debugger"],
    },
    {
      agentSlug: "reviewer",
      input: `Bug fix implemented.\n\n${context}\n\nReview the fix for correctness and regressions. Confirm the bug is resolved.`,
      dependsOn: ["engineer"],
    },
    {
      agentSlug: "devops",
      input: `Bug fix reviewed and approved.\n\n${context}\n\nCommit with a "fix:" conventional commit message. Merge the hotfix branch if applicable.`,
      dependsOn: ["reviewer"],
    },
  ];
}
