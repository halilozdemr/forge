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
      input: `Normalize release request into execution_brief.\n\n${context}\n\nReturn contract JSON only.`,
      dependsOn: [],
    },
    {
      key: "architect",
      agentSlug: "architect",
      input: `Build architecture_plan for release from execution_brief.\n\n${context}\n\nReturn contract JSON only.`,
      dependsOn: ["intake-gate"],
    },
    {
      key: "builder",
      agentSlug: "builder",
      input: `Build work_result for release readiness from execution_brief + architecture_plan.\n\n${context}\n\nReturn contract JSON only.`,
      dependsOn: ["architect"],
    },
    {
      key: "quality-guard",
      agentSlug: "quality-guard",
      input: `Validate release work_result against execution_brief + architecture_plan.\n\n${context}\n\nReturn contract JSON only.`,
      dependsOn: ["builder"],
    },
    {
      key: "devops",
      agentSlug: "devops",
      input: `Produce devops_report for release readiness.\n\n${context}\n\nReturn contract JSON only.`,
      dependsOn: ["quality-guard"],
    },
    {
      key: "retrospective-analyst",
      agentSlug: "retrospective-analyst",
      input: `Produce optional learning_report for release execution.\n\n${context}\n\nReturn contract JSON only.`,
      dependsOn: ["devops"],
    },
  ];
}
