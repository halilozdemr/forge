import type { PipelineStep } from "../index.js";

/**
 * Official release pipeline:
 * intake-gate -> architect -> builder -> quality-guard -> devops -> retrospective-analyst
 */
export function buildReleasePipeline(opts: {
  issueId: string;
  title: string;
  description?: string;
}): PipelineStep[] {
  const context = `Release: "${opts.title}"\n${opts.description ?? ""}`;

  return [
    {
      key: "intake-gate",
      agentSlug: "intake-gate",
      input: `Normalize release request into execution_brief.\n\n${context}`,
      dependsOn: [],
    },
    {
      key: "architect",
      agentSlug: "architect",
      input: `Build architecture_plan for release from execution_brief.\n\n${context}`,
      dependsOn: ["intake-gate"],
    },
    {
      key: "builder",
      agentSlug: "builder",
      input: `Prepare the release by creating/editing actual files in the workspace, then return work_result JSON.\n\n${context}`,
      dependsOn: ["architect"],
    },
    {
      key: "quality-guard",
      agentSlug: "quality-guard",
      input: `Validate release work_result artifacts against execution_brief and architecture_plan. The prior stage outputs are provided below.\n\n${context}`,
      dependsOn: ["builder"],
      loopsBackTo: "builder",
      maxRevisions: 2,
    },
    {
      key: "devops",
      agentSlug: "devops",
      input: `Produce devops_report for release readiness.\n\n${context}`,
      dependsOn: ["quality-guard"],
    },
    {
      key: "retrospective-analyst",
      agentSlug: "retrospective-analyst",
      input: `Produce learning_report for release execution. Only report success if work_result.artifacts contains actual created files.\n\n${context}`,
      dependsOn: ["devops"],
    },
  ];
}
