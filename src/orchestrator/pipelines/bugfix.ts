import type { PipelineStep } from "../index.js";

/**
 * Official bug pipeline:
 * intake-gate -> architect -> builder -> quality-guard -> devops
 */
export function buildBugfixPipeline(opts: {
  issueId: string;
  title: string;
  description?: string;
}): PipelineStep[] {
  const context = `Bug: "${opts.title}"\n${opts.description ?? ""}`;

  return [
    {
      key: "intake-gate",
      agentSlug: "intake-gate",
      input: `Normalize bug request into execution_brief.\n\n${context}`,
      dependsOn: [],
    },
    {
      key: "architect",
      agentSlug: "architect",
      input: `Build architecture_plan for bug fix from execution_brief.\n\n${context}`,
      dependsOn: ["intake-gate"],
    },
    {
      key: "builder",
      agentSlug: "builder",
      input: `Fix the bug by editing actual files in the workspace, then return work_result JSON.\n\n${context}`,
      dependsOn: ["architect"],
    },
    {
      key: "quality-guard",
      agentSlug: "quality-guard",
      input: `Validate the bug-fix work_result artifacts against execution_brief and architecture_plan. The prior stage outputs are provided below.\n\n${context}`,
      dependsOn: ["builder"],
      loopsBackTo: "builder",
      maxRevisions: 2,
    },
    {
      key: "devops",
      agentSlug: "devops",
      input: `Produce devops_report for hotfix readiness.\n\n${context}`,
      dependsOn: ["quality-guard"],
    },
  ];
}
