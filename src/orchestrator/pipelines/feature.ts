import type { PipelineStep } from "../index.js";

/**
 * Official feature pipeline:
 * intake-gate -> architect -> builder -> quality-guard -> devops -> retrospective-analyst
 */
export function buildFeaturePipeline(opts: {
  issueId: string;
  title: string;
  description?: string;
}): PipelineStep[] {
  const context = `Issue: "${opts.title}"\n${opts.description ?? ""}`;

  return [
    {
      key: "intake-gate",
      agentSlug: "intake-gate",
      input: `Normalize request into execution_brief.\n\n${context}`,
      dependsOn: [],
    },
    {
      key: "architect",
      agentSlug: "architect",
      input: `Build architecture_plan from execution_brief.\n\n${context}`,
      dependsOn: ["intake-gate"],
    },
    {
      key: "builder",
      agentSlug: "builder",
      input: `Implement the feature by creating actual files in the workspace, then return work_result JSON.\n\n${context}`,
      dependsOn: ["architect"],
    },
    {
      key: "quality-guard",
      agentSlug: "quality-guard",
      input: `Validate the work_result artifacts against execution_brief and architecture_plan. The prior stage outputs are provided below.\n\n${context}`,
      dependsOn: ["builder"],
    },
    {
      key: "devops",
      agentSlug: "devops",
      input: `Produce devops_report for branch/PR/release readiness.\n\n${context}`,
      dependsOn: ["quality-guard"],
    },
    {
      key: "retrospective-analyst",
      agentSlug: "retrospective-analyst",
      input: `Produce learning_report from the completed run. Only report success if work_result.artifacts contains actual created files.\n\n${context}`,
      dependsOn: ["devops"],
    },
  ];
}
