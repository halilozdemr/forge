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
  it("builds feature pipeline from intake-gate through official stage sequence", () => {
    const steps = buildFeaturePipeline(baseIssue);

    expect(steps.map((step) => step.key)).toEqual([
      "intake-gate",
      "architect",
      "builder",
      "quality-guard",
      "devops",
      "retrospective-analyst",
    ]);

    expect(steps.map((step) => step.agentSlug)).toEqual([
      "intake-gate",
      "architect",
      "builder",
      "quality-guard",
      "devops",
      "retrospective-analyst",
    ]);
  });

  it("builds bugfix, refactor, and release pipelines on official slugs", () => {
    expect(buildBugfixPipeline(baseIssue).map((step) => step.agentSlug)).toEqual([
      "intake-gate",
      "architect",
      "builder",
      "quality-guard",
      "devops",
    ]);

    expect(buildRefactorPipeline(baseIssue).map((step) => step.agentSlug)).toEqual([
      "intake-gate",
      "architect",
      "builder",
      "quality-guard",
      "devops",
    ]);

    expect(buildReleasePipeline(baseIssue).map((step) => step.key)).toEqual([
      "intake-gate",
      "architect",
      "builder",
      "quality-guard",
      "devops",
      "retrospective-analyst",
    ]);
  });
});
