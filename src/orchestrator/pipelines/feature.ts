import type { PipelineStep } from "../index.js";

/**
 * Feature pipeline:
 * CEO → PM → DevOps(branch) → Architect → Engineer → Reviewer → DevOps(commit) → Scrum-Master
 */
export function buildFeaturePipeline(opts: {
  issueId: string;
  title: string;
  description?: string;
}): PipelineStep[] {
  const context = `Issue: "${opts.title}"\n${opts.description ?? ""}`;

  return [
    {
      agentSlug: "ceo",
      input: `New feature request received.\n\n${context}\n\nReview the request, write a brief spec, and hand off to the PM.`,
      dependsOn: [],
    },
    {
      agentSlug: "pm",
      input: `Feature spec approved by CEO.\n\n${context}\n\nDecompose into sub-tasks, estimate complexity, and hand off to the architect for technical design.`,
      dependsOn: ["ceo"],
    },
    {
      agentSlug: "devops",
      input: `PM has decomposed the feature.\n\n${context}\n\nCreate a new feature branch following GitFlow conventions (feature/<slug>).`,
      dependsOn: ["pm"],
    },
    {
      agentSlug: "architect",
      input: `Feature branch created.\n\n${context}\n\nDesign the technical architecture, choose patterns, write the implementation plan in .forge/memory/decisions.md.`,
      dependsOn: ["devops"],
    },
    {
      agentSlug: "engineer",
      input: `Architecture plan ready.\n\n${context}\n\nImplement the feature following the architect's plan. Write tests. Follow conventions in .forge/context/conventions.md.`,
      dependsOn: ["architect"],
    },
    {
      agentSlug: "reviewer",
      input: `Engineer has completed implementation.\n\n${context}\n\nReview the code for quality, security, and adherence to standards in .forge/context/standards.md. Approve or request changes.`,
      dependsOn: ["engineer"],
    },
    {
      agentSlug: "devops",
      input: `Code review passed.\n\n${context}\n\nCommit the changes with a conventional commit message, then merge the feature branch.`,
      dependsOn: ["reviewer"],
    },
    {
      agentSlug: "scrum-master",
      input: `Feature "${opts.title}" delivered.\n\n${context}\n\nUpdate the sprint backlog, mark the issue done, record any learnings in .forge/memory/patterns.md.`,
      dependsOn: ["devops"],
    },
  ];
}
