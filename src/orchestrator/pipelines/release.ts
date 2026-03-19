import type { PipelineStep } from "../index.js";

/**
 * Release pipeline:
 * CEO → DevOps(build) → DevOps(tag + merge) → Scrum-Master(retrospective)
 */
export function buildReleasePipeline(opts: {
  issueId: string;
  title: string;
  description?: string;
}): PipelineStep[] {
  const context = `Release: "${opts.title}"\n${opts.description ?? ""}`;

  return [
    {
      agentSlug: "ceo",
      input: `Release request received.\n\n${context}\n\nApprove the release. Verify all planned issues are done. Confirm the version number and release notes.`,
      dependsOn: [],
    },
    {
      agentSlug: "devops",
      input: `Release approved by CEO.\n\n${context}\n\nRun the build process. Verify artifacts are clean. Create the release branch if needed.`,
      dependsOn: ["ceo"],
    },
    {
      agentSlug: "devops",
      input: `Build complete.\n\n${context}\n\nTag the release commit (e.g., v1.2.0). Merge the release branch into main. Push the tag.`,
      dependsOn: ["devops"],
    },
    {
      agentSlug: "scrum-master",
      input: `Release "${opts.title}" shipped.\n\n${context}\n\nClose the sprint, write a retrospective in .forge/memory/retrospectives/, update the backlog for next sprint.`,
      dependsOn: ["devops"],
    },
  ];
}
