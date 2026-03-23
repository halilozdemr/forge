import type { PipelineStep } from "../index.js";

/**
 * Release pipeline:
 * Approved brief → DevOps(build) → DevOps(tag + merge) → Scrum-Master(retrospective)
 */
export function buildReleasePipeline(opts: {
  issueId: string;
  title: string;
  description?: string;
}): PipelineStep[] {
  const context = `Release: "${opts.title}"\n${opts.description ?? ""}`;

  return [
    {
      key: "devops-build",
      agentSlug: "devops",
      input: `Release brief already approved by the client.\n\n${context}\n\nRun the build process. Verify artifacts are clean. Create the release branch if needed.`,
      dependsOn: [],
    },
    {
      key: "devops-release",
      agentSlug: "devops",
      input: `Build complete.\n\n${context}\n\nTag the release commit (e.g., v1.2.0). Merge the release branch into main. Push the tag.`,
      dependsOn: ["devops-build"],
    },
    {
      key: "scrum_master",
      agentSlug: "scrum_master",
      input: `Release "${opts.title}" shipped.\n\n${context}\n\nClose the sprint, write a retrospective in .forge/memory/retrospectives/, update the backlog for next sprint.`,
      dependsOn: ["devops-release"],
    },
  ];
}
