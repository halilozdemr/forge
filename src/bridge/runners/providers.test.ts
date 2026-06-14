import { describe, expect, it } from "vitest";
import {
  MODEL_PROVIDERS,
  MODEL_PROVIDER_IDS,
  getProvider,
  isKnownProvider,
  isRoutableProvider,
  listRoutableProviders,
  defaultModelFor,
} from "./providers.js";

describe("model provider registry", () => {
  it("exposes a stable, unique set of provider ids", () => {
    const ids = MODEL_PROVIDERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(MODEL_PROVIDER_IDS).toEqual(ids);
  });

  it("covers every backend the runner factory can construct", () => {
    // Keep in lockstep with createRunner's switch cases.
    const factoryProviders = [
      "claude-cli",
      "openrouter",
      "anthropic-api",
      "gemini-cli",
      "gemini-api",
      "codex-cli",
      "opencode-cli",
      "ollama",
      "process",
      "http",
      "cursor",
    ];
    expect(new Set(MODEL_PROVIDER_IDS)).toEqual(new Set(factoryProviders));
  });

  it("recognises known providers and rejects unknown ones", () => {
    expect(isKnownProvider("gemini-api")).toBe(true);
    expect(isKnownProvider("  ollama  ")).toBe(true);
    expect(isKnownProvider("openai")).toBe(false);
    expect(isKnownProvider("nonsense")).toBe(false);
  });

  it("treats internal bridges as non-routable", () => {
    expect(isRoutableProvider("claude-cli")).toBe(true);
    expect(isRoutableProvider("process")).toBe(false);
    expect(isRoutableProvider("http")).toBe(false);
    const routableIds = listRoutableProviders().map((p) => p.id);
    expect(routableIds).not.toContain("process");
    expect(routableIds).not.toContain("http");
    expect(routableIds).toContain("ollama");
  });

  it("provides a default model for every routable provider", () => {
    for (const provider of listRoutableProviders()) {
      expect(defaultModelFor(provider.id)).toBeTruthy();
      expect(getProvider(provider.id)).toBe(provider);
    }
    expect(defaultModelFor("openai")).toBeUndefined();
  });

  it("declares an availability signal for every routable provider", () => {
    for (const provider of listRoutableProviders()) {
      const hasSignal =
        Boolean(provider.apiKeyEnv) ||
        Boolean(provider.cliBinary) ||
        Boolean(provider.baseUrlEnv) ||
        provider.id === "cursor";
      expect(hasSignal).toBe(true);
    }
  });
});
