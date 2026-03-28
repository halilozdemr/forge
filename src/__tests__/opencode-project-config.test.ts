import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { OFFICIAL_AGENT_SLUGS, buildDefaultClientConfigForSlug } from "../agents/constants.js";
import { syncProjectOpenCodeConfig } from "../opencode/project-config.js";
import { buildFeaturePipeline } from "../orchestrator/pipelines/feature.js";

describe("syncProjectOpenCodeConfig", () => {
  let projectPath: string | null = null;

  afterEach(async () => {
    if (!projectPath) return;
    await rm(projectPath, { recursive: true, force: true });
    projectPath = null;
  });

  it("keeps default init OpenCode agents on the classic official workflow set", async () => {
    projectPath = await mkdtemp(join(tmpdir(), "forge-opencode-config-"));

    await syncProjectOpenCodeConfig({
      project: { path: projectPath },
      agentStrategy: {
        heavy: { provider: "claude-cli", model: "sonnet" },
        light: { provider: "claude-cli", model: "sonnet" },
      },
    });

    const manifest = JSON.parse(
      await readFile(join(projectPath, ".opencode", "agents", ".forge-generated.json"), "utf-8"),
    ) as { slugs?: string[] };

    expect(manifest.slugs).toEqual([...OFFICIAL_AGENT_SLUGS]);
    expect(manifest.slugs).not.toContain("planner");
    expect(manifest.slugs).not.toContain("evaluator");
    expect(manifest.slugs).not.toContain("harness-builder");

    const opencodeConfig = JSON.parse(
      await readFile(join(projectPath, ".opencode", "opencode.json"), "utf-8"),
    ) as { default_agent?: string };

    expect(opencodeConfig.default_agent).toBe("intake-gate");
  });

  it("marks harness agents as internal-only client projections by default", () => {
    expect(buildDefaultClientConfigForSlug("planner")).toMatchObject({
      namespace: "official",
      pipelineEligible: true,
      authoritative: true,
      visibleIn: [],
      entrypoint: false,
    });
  });

  it("keeps the classic feature pipeline on the legacy official workflow agents", () => {
    const steps = buildFeaturePipeline({
      issueId: "issue-1",
      title: "Test request",
      description: "Detailed request",
    });

    expect(steps.map((step) => step.agentSlug)).toEqual([
      "intake-gate",
      "architect",
      "builder",
      "quality-guard",
      "devops",
      "retrospective-analyst",
    ]);
  });
});
