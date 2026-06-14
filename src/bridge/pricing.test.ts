import { describe, expect, it } from "vitest";
import { estimateCost, resolveRate, METERED_PROVIDERS } from "./pricing.js";

describe("resolveRate", () => {
  it("matches anthropic tiers most-specific first", () => {
    expect(resolveRate("anthropic-api", "claude-opus-4")).toEqual({ input: 15, output: 75 });
    expect(resolveRate("anthropic-api", "claude-sonnet-4-6")).toEqual({ input: 3, output: 15 });
    expect(resolveRate("anthropic-api", "claude-haiku-4-5")).toEqual({ input: 0.25, output: 1.25 });
  });

  it("distinguishes gpt-4o from gpt-4o-mini", () => {
    expect(resolveRate("openai", "gpt-4o-mini")).toEqual({ input: 0.15, output: 0.6 });
    expect(resolveRate("openai", "gpt-4o")).toEqual({ input: 2.5, output: 10 });
  });

  it("matches gemini flash variants before pro", () => {
    expect(resolveRate("gemini-api", "gemini-2.0-flash-lite")).toEqual({ input: 0.05, output: 0.2 });
    expect(resolveRate("gemini-api", "gemini-2.0-flash")).toEqual({ input: 0.1, output: 0.4 });
    expect(resolveRate("gemini-api", "gemini-2.5-pro")).toEqual({ input: 1.25, output: 5 });
  });

  it("falls back per provider for unrecognised models", () => {
    expect(resolveRate("openai", "some-future-model")).toEqual({ input: 2.5, output: 10 });
    expect(resolveRate("openrouter", "anything")).toEqual({ input: 1, output: 3 });
  });

  it("returns null for unmetered backends", () => {
    expect(resolveRate("claude-cli", "sonnet")).toBeNull();
    expect(resolveRate("ollama", "llama3.2")).toBeNull();
    expect(resolveRate("gemini-cli", "gemini-2.5-pro")).toBeNull();
  });
});

describe("estimateCost", () => {
  it("computes USD from per-1M rates", () => {
    // gpt-4o: 1M input @ $2.5 + 1M output @ $10 = $12.5
    expect(estimateCost("openai", "gpt-4o", 1_000_000, 1_000_000)).toBeCloseTo(12.5, 6);
    // sonnet: 1000 in @ $3/M + 500 out @ $15/M
    expect(estimateCost("anthropic-api", "claude-sonnet-4-6", 1000, 500)).toBeCloseTo(
      (1000 * 3 + 500 * 15) / 1_000_000,
      9,
    );
  });

  it("is zero for unmetered providers and preserves legacy claude-cli behaviour", () => {
    expect(estimateCost("claude-cli", "sonnet", 1000, 1000)).toBe(0);
    expect(estimateCost("cursor", "default", 1000, 1000)).toBe(0);
  });

  it("now meters openai and gemini-api (previously $0)", () => {
    expect(estimateCost("openai", "gpt-4o-mini", 1_000_000, 0)).toBeCloseTo(0.15, 6);
    expect(estimateCost("gemini-api", "gemini-2.5-pro", 0, 1_000_000)).toBeCloseTo(5, 6);
  });

  it("clamps negative token counts to zero", () => {
    expect(estimateCost("openai", "gpt-4o", -100, -100)).toBe(0);
  });

  it("meters anthropic-api, openrouter, openai, and gemini-api", () => {
    expect(METERED_PROVIDERS).toEqual(
      expect.arrayContaining(["anthropic-api", "openrouter", "openai", "gemini-api"]),
    );
    expect(METERED_PROVIDERS).not.toContain("claude-cli");
  });
});
