import type { PipelineStep } from "../index.js";

/**
 * Feature pipeline:
 * Approved brief → PM → DevOps(branch) → Architect → Builder → Reviewer → DevOps(merge) → Scrum-Master
 */
export function buildFeaturePipeline(opts: {
  issueId: string;
  title: string;
  description?: string;
}): PipelineStep[] {
  const context = `Issue: "${opts.title}"\n${opts.description ?? ""}`;

  return [
    {
      key: "pm",
      agentSlug: "pm",
      input: `Feature brief already approved by the client.\n\n${context}\n\nDecompose the work into actionable sub-tasks, estimate complexity, and prepare the execution plan for implementation.`,
      dependsOn: [],
    },
    {
      key: "devops-branch",
      agentSlug: "devops",
      input: `PM planning is complete.\n\n${context}\n\nCreate a new feature branch following GitFlow conventions (feature/<slug>) and prepare the workspace for implementation.`,
      dependsOn: ["pm"],
    },
    {
      key: "architect",
      agentSlug: "architect",
      input: `Feature branch created.\n\n${context}\n\nDesign the technical architecture, choose patterns, write the implementation plan in .forge/memory/decisions.md.`,
      dependsOn: ["devops-branch"],
    },
    {
      key: "builder",
      agentSlug: "builder",
      input: `Architecture plan ready.\n\n${context}\n\nRead the implementation plan from .forge/memory/decisions.md before writing any code. Implement the feature following the architect's plan. Write tests. Follow conventions in .forge/context/conventions.md.`,
      dependsOn: ["architect"],
    },
    {
      key: "reviewer",
      agentSlug: "reviewer",
      input: `Builder has completed implementation.\n\n${context}\n\nReview the code for quality, security, and adherence to standards in .forge/context/standards.md. Approve or request changes.`,
      dependsOn: ["builder"],
      loopsBackTo: "builder",
      maxRevisions: 3,
    },
    {
      key: "devops-merge",
      agentSlug: "devops",
      input: `Code review passed.\n\n${context}\n\nCommit the changes with a conventional commit message, then merge the feature branch.`,
      dependsOn: ["reviewer"],
    },
    {
      key: "scrum_master",
      agentSlug: "scrum_master",
      input: `Feature "${opts.title}" delivered.\n\n${context}\n\nUpdate the sprint backlog, mark the issue done, record any learnings in .forge/memory/patterns.md.`,
      dependsOn: ["devops-merge"],
    },
  ];
}
