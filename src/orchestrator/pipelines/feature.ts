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
      input: `Normalize request into execution_brief.\n\n${context}\n\nReturn contract JSON only.`,
      dependsOn: [],
    },
    {
      key: "architect",
      agentSlug: "architect",
      input: `Build architecture_plan from execution_brief.\n\n${context}\n\nDo not orchestrate; return contract JSON only.`,
      dependsOn: ["intake-gate"],
    },
    {
      key: "builder",
      agentSlug: "builder",
      input: `Build work_result from execution_brief + architecture_plan.\n\n${context}\n\nDo not re-plan; return contract JSON only.`,
      dependsOn: ["architect"],
    },
    {
      key: "quality-guard",
      agentSlug: "quality-guard",
      input: `Validate work_result against execution_brief + architecture_plan.\n\n${context}\n\nDo not repair; return contract JSON only.`,
      dependsOn: ["builder"],
    },
    {
      key: "devops",
      agentSlug: "devops",
      input: `Produce optional devops_report for branch/PR/release readiness.\n\n${context}\n\nReturn contract JSON only.`,
      dependsOn: ["quality-guard"],
    },
    {
      key: "retrospective-analyst",
      agentSlug: "retrospective-analyst",
      input: `Produce optional learning_report from the completed run.\n\n${context}\n\nReturn contract JSON only.`,
      dependsOn: ["devops"],
    },
  ];
}
