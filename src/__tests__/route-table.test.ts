import { describe, expect, it } from "vitest";
import {
  type ProviderProbe,
  formatRouteTable,
  presetIsApplicable,
  providerAvailability,
  resolvePresetAssignments,
  resolveRouteAssignment,
  sortRouteRows,
} from "../cli/route-table.js";

const emptyProbe: ProviderProbe = {
  getEnv: () => undefined,
  hasBinary: () => false,
};

function probeWith(env: Record<string, string>, binaries: string[] = []): ProviderProbe {
  return {
    getEnv: (name) => env[name],
    hasBinary: (name) => binaries.includes(name),
  };
}

describe("providerAvailability", () => {
  it("reports api providers based on their key env var", () => {
    expect(providerAvailability("openrouter", emptyProbe)).toEqual({
      status: "missing",
      detail: "OPENROUTER_API_KEY not set",
    });
    expect(providerAvailability("openrouter", probeWith({ OPENROUTER_API_KEY: "sk-x" }))).toEqual({
      status: "available",
      detail: "OPENROUTER_API_KEY set",
    });
  });

  it("reports cli providers based on PATH or a path override", () => {
    expect(providerAvailability("claude-cli", emptyProbe)).toEqual({
      status: "missing",
      detail: "claude not found",
    });
    expect(providerAvailability("claude-cli", probeWith({}, ["claude"]))).toEqual({
      status: "available",
      detail: "claude on PATH",
    });
    expect(providerAvailability("claude-cli", probeWith({ CLAUDE_CLI_PATH: "/x/claude" }))).toEqual({
      status: "available",
      detail: "via CLAUDE_CLI_PATH",
    });
  });

  it("treats local providers as runtime-verified unless a base url is set", () => {
    expect(providerAvailability("ollama", emptyProbe).status).toBe("unknown");
    expect(providerAvailability("ollama", probeWith({ OLLAMA_BASE_URL: "http://h" })).status).toBe(
      "available",
    );
  });

  it("flags unknown providers as missing", () => {
    expect(providerAvailability("vertex-ai", emptyProbe)).toEqual({
      status: "missing",
      detail: "unknown provider",
    });
  });
});

describe("resolveRouteAssignment", () => {
  it("fills the provider default model when none is supplied", () => {
    expect(resolveRouteAssignment("anthropic-api")).toEqual({
      provider: "anthropic-api",
      model: "claude-sonnet-4-6",
    });
  });

  it("trims and keeps an explicit model", () => {
    expect(resolveRouteAssignment("  claude-cli  ", "  opus  ")).toEqual({
      provider: "claude-cli",
      model: "opus",
    });
  });

  it("rejects internal bridges and unknown providers", () => {
    expect(() => resolveRouteAssignment("process")).toThrow(/internal bridge/);
    expect(() => resolveRouteAssignment("vertex-ai")).toThrow(/not a known provider/);
  });
});

describe("resolvePresetAssignments", () => {
  const agents = [
    { slug: "architect" },
    { slug: "builder" },
    { slug: "quality-guard" },
  ];
  const strategy = {
    heavy: { provider: "claude-cli", model: "opus" },
    light: { provider: "openrouter", model: "deepseek/deepseek-v3-0324:free" },
  };

  it("maps heavy agents to the heavy tier and the rest to light", () => {
    const result = resolvePresetAssignments(strategy, agents, ["architect", "quality-guard"]);
    expect(result).toEqual([
      { slug: "architect", provider: "claude-cli", model: "opus", tier: "heavy" },
      { slug: "builder", provider: "openrouter", model: "deepseek/deepseek-v3-0324:free", tier: "light" },
      { slug: "quality-guard", provider: "claude-cli", model: "opus", tier: "heavy" },
    ]);
  });

  it("rejects presets that reference an unrunnable provider", () => {
    const broken = {
      heavy: { provider: "vertex-ai", model: "gemini-pro" },
      light: { provider: "openrouter", model: "x" },
    };
    expect(() => resolvePresetAssignments(broken, agents, [])).toThrow(/not a routable provider/);
  });
});

describe("presetIsApplicable", () => {
  it("is true only when both tiers are routable backends", () => {
    expect(
      presetIsApplicable({
        heavy: { provider: "claude-cli", model: "sonnet" },
        light: { provider: "openrouter", model: "x" },
      }),
    ).toBe(true);
    expect(
      presetIsApplicable({
        heavy: { provider: "vertex-ai", model: "gemini-pro" },
        light: { provider: "openrouter", model: "x" },
      }),
    ).toBe(false);
  });
});

describe("sortRouteRows", () => {
  it("orders by pipeline position then alphabetically for custom agents", () => {
    const rows = [
      { slug: "zeta-custom", name: "", provider: "claude-cli", model: "x" },
      { slug: "builder", name: "", provider: "claude-cli", model: "x" },
      { slug: "intake-gate", name: "", provider: "claude-cli", model: "x" },
      { slug: "alpha-custom", name: "", provider: "claude-cli", model: "x" },
    ];
    expect(sortRouteRows(rows).map((r) => r.slug)).toEqual([
      "intake-gate",
      "builder",
      "alpha-custom",
      "zeta-custom",
    ]);
  });
});

describe("formatRouteTable", () => {
  it("renders a header and one row per stage with backend status", () => {
    const lines = formatRouteTable(
      [{ slug: "builder", name: "Builder", provider: "claude-cli", model: "sonnet" }],
      probeWith({}, ["claude"]),
    );
    expect(lines[0]).toMatch(/STAGE/);
    expect(lines[0]).toMatch(/BACKEND/);
    expect(lines.some((l) => l.includes("builder") && l.includes("ready"))).toBe(true);
  });

  it("returns a hint when there are no agents", () => {
    expect(formatRouteTable([], emptyProbe)).toEqual(["No agents found. Run `forge init` first."]);
  });
});
