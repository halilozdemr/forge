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
      input: `Normalize bug request into execution_brief.\n\n${context}\n\nReturn contract JSON only.`,
      dependsOn: [],
    },
    {
      key: "architect",
      agentSlug: "architect",
      input: `Build architecture_plan for bug fix from execution_brief.\n\n${context}\n\nReturn contract JSON only.`,
      dependsOn: ["intake-gate"],
    },
    {
      key: "builder",
      agentSlug: "builder",
      input: `Build work_result for bug fix from execution_brief + architecture_plan.\n\n${context}\n\nReturn contract JSON only.`,
      dependsOn: ["architect"],
    },
    {
      key: "quality-guard",
      agentSlug: "quality-guard",
      input: `Validate bug-fix work_result against execution_brief + architecture_plan.\n\n${context}\n\nReturn contract JSON only.`,
      dependsOn: ["builder"],
    },
    {
      key: "devops",
      agentSlug: "devops",
      input: `Produce optional devops_report for hotfix readiness.\n\n${context}\n\nReturn contract JSON only.`,
      dependsOn: ["quality-guard"],
    },
  ];
}
