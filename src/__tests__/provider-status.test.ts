import { describe, it, expect } from "vitest";
import {
  providerRequirement,
  resolveProviderAvailability,
  resolveProvidersAvailability,
  type AvailabilityProbes,
} from "../cli/provider-status.js";

const noBackends: AvailabilityProbes = { hasCli: () => false, hasEnv: () => false };
const allBackends: AvailabilityProbes = { hasCli: () => true, hasEnv: () => true };

describe("providerRequirement", () => {
  it("maps CLI providers to the expected binary", () => {
    expect(providerRequirement("claude-cli")).toMatchObject({ kind: "cli", cli: "claude" });
    expect(providerRequirement("gemini-cli")).toMatchObject({ kind: "cli", cli: "gemini" });
    expect(providerRequirement("codex-cli")).toMatchObject({ kind: "cli", cli: "codex" });
    expect(providerRequirement("opencode-cli")).toMatchObject({ kind: "cli", cli: "opencode" });
  });

  it("maps API providers to their env vars", () => {
    expect(providerRequirement("anthropic-api")).toMatchObject({ kind: "env", envVars: ["ANTHROPIC_API_KEY"] });
    expect(providerRequirement("openrouter")).toMatchObject({ kind: "env", envVars: ["OPENROUTER_API_KEY"] });
    expect(providerRequirement("gemini-api")).toMatchObject({ kind: "env", envVars: ["GOOGLE_AI_API_KEY"] });
  });

  it("treats endpoint and local providers as their own kinds", () => {
    expect(providerRequirement("ollama").kind).toBe("endpoint");
    expect(providerRequirement("cursor").kind).toBe("endpoint");
    expect(providerRequirement("http").kind).toBe("endpoint");
    expect(providerRequirement("process").kind).toBe("local");
  });

  it("defaults unknown providers to a neutral endpoint labeled with the provider name", () => {
    expect(providerRequirement("made-up-provider")).toEqual({ kind: "endpoint", label: "made-up-provider" });
  });
});

describe("resolveProviderAvailability", () => {
  it("reports CLI providers ready only when the binary is found", () => {
    expect(resolveProviderAvailability("claude-cli", allBackends).status).toBe("ready");
    expect(resolveProviderAvailability("claude-cli", noBackends)).toMatchObject({
      status: "missing",
      detail: "claude not installed",
    });
  });

  it("reports env providers ready only when a key is present", () => {
    expect(resolveProviderAvailability("anthropic-api", allBackends)).toMatchObject({
      status: "ready",
      detail: "ANTHROPIC_API_KEY set",
    });
    expect(resolveProviderAvailability("anthropic-api", noBackends).status).toBe("missing");
  });

  it("only counts the env var that is actually present", () => {
    const onlyOpenRouter: AvailabilityProbes = {
      hasCli: () => false,
      hasEnv: (name) => name === "OPENROUTER_API_KEY",
    };
    expect(resolveProviderAvailability("openrouter", onlyOpenRouter).status).toBe("ready");
    expect(resolveProviderAvailability("anthropic-api", onlyOpenRouter).status).toBe("missing");
  });

  it("reports endpoint and local providers as unknown regardless of probes", () => {
    expect(resolveProviderAvailability("ollama", noBackends).status).toBe("unknown");
    expect(resolveProviderAvailability("cursor", allBackends).status).toBe("unknown");
    expect(resolveProviderAvailability("process", noBackends).status).toBe("unknown");
  });
});

describe("resolveProvidersAvailability", () => {
  it("resolves each distinct provider once and keys the map by provider", () => {
    let cliProbes = 0;
    const counting: AvailabilityProbes = {
      hasCli: () => {
        cliProbes++;
        return false;
      },
      hasEnv: () => false,
    };

    const map = resolveProvidersAvailability(["claude-cli", "claude-cli", "gemini-cli"], counting);

    expect(map.size).toBe(2);
    expect(map.get("claude-cli")?.status).toBe("missing");
    expect(map.get("gemini-cli")?.status).toBe("missing");
    // claude-cli probed once despite appearing twice; gemini-cli probed once.
    expect(cliProbes).toBe(2);
  });
});
