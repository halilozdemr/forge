import { describe, expect, it } from "vitest";
import { buildAgentEditPayload } from "./agent.js";

describe("buildAgentEditPayload", () => {
  it("builds payload with aliases and nullable fields", () => {
    const payload = buildAgentEditPayload({
      company: "company-1",
      name: "  Architect  ",
      description: "  Lead Architect  ",
      provider: "claude-cli",
      model: "sonnet",
      promptFile: "null",
      heartbeat: "null",
      permissions: "{\"read\":true,\"task\":false}",
    });

    expect(payload).toEqual({
      companyId: "company-1",
      name: "Architect",
      role: "Lead Architect",
      modelProvider: "claude-cli",
      model: "sonnet",
      promptFile: null,
      heartbeatCron: null,
      permissions: { read: true, task: false },
    });
  });

  it("throws for unsupported model providers", () => {
    expect(() =>
      buildAgentEditPayload({
        company: "company-1",
        provider: "unknown-provider",
      })
    ).toThrow("Unsupported model provider");
  });

  it("throws for invalid model format", () => {
    expect(() =>
      buildAgentEditPayload({
        company: "company-1",
        model: "bad model with spaces",
      })
    ).toThrow("Invalid model format");
  });
});
