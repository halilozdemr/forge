import { describe, expect, it } from "vitest";
import { buildFeaturePipeline } from "./feature.js";
import { buildBugfixPipeline } from "./bugfix.js";
import { buildRefactorPipeline } from "./refactor.js";
import { buildReleasePipeline } from "./release.js";

const baseIssue = {
  issueId: "issue_123",
  title: "Test request",
  description: "Detailed request",
};

describe("pipeline builders", () => {
  it("builds feature pipeline starting from PM for client-approved intake", () => {
    const steps = buildFeaturePipeline(baseIssue);

    expect(steps.map((step) => step.key)).toEqual([
      "pm",
      "devops-branch",
      "architect",
      "builder",
      "reviewer",
      "devops-merge",
      "scrum_master",
    ]);

    expect(steps.map((step) => step.agentSlug)).toEqual([
      "pm",
      "devops",
      "architect",
      "builder",
      "reviewer",
      "devops",
      "scrum_master",
    ]);
  });

  it("builds bugfix, refactor, and release pipelines on runtime slugs", () => {
    expect(buildBugfixPipeline(baseIssue).map((step) => step.agentSlug)).toEqual([
      "debugger",
      "reviewer",
      "devops",
    ]);

    expect(buildRefactorPipeline(baseIssue).map((step) => step.agentSlug)).toEqual([
      "architect",
      "builder",
      "reviewer",
      "devops",
    ]);

    expect(buildReleasePipeline(baseIssue).map((step) => step.key)).toEqual([
      "devops-build",
      "devops-release",
      "scrum_master",
    ]);
  });
});
