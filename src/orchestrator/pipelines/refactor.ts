import type { PipelineStep } from "../index.js";

/**
 * Official refactor pipeline:
 * intake-gate -> architect -> builder -> quality-guard -> devops
 */
export function buildRefactorPipeline(opts: {
  issueId: string;
  title: string;
  description?: string;
}): PipelineStep[] {
  const context = `Refactor: "${opts.title}"\n${opts.description ?? ""}`;

  return [
    {
      key: "intake-gate",
      agentSlug: "intake-gate",
      input: `Normalize refactor request into execution_brief.\n\n${context}\n\nReturn contract JSON only.`,
      dependsOn: [],
    },
    {
      key: "architect",
      agentSlug: "architect",
      input: `Build architecture_plan for refactor from execution_brief.\n\n${context}\n\nReturn contract JSON only.`,
      dependsOn: ["intake-gate"],
    },
    {
      key: "builder",
      agentSlug: "builder",
      input: `Build work_result for refactor from execution_brief + architecture_plan.\n\n${context}\n\nReturn contract JSON only.`,
      dependsOn: ["architect"],
    },
    {
      key: "quality-guard",
      agentSlug: "quality-guard",
      input: `Validate refactor work_result against execution_brief + architecture_plan.\n\n${context}\n\nReturn contract JSON only.`,
      dependsOn: ["builder"],
    },
    {
      key: "devops",
      agentSlug: "devops",
      input: `Produce optional devops_report for refactor branch/PR readiness.\n\n${context}\n\nReturn contract JSON only.`,
      dependsOn: ["quality-guard"],
    },
  ];
}
