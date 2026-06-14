import { describe, it, expect } from "vitest";
import { MODEL_PROVIDERS, isSupportedModelProvider } from "../bridge/runners/providers.js";
import { createRunner } from "../bridge/runners/factory.js";
import { SUPPORTED_MODEL_PROVIDERS } from "../agents/validation.js";

describe("model provider registry", () => {
  it("accepts every canonical provider and trims input", () => {
    for (const provider of MODEL_PROVIDERS) {
      expect(isSupportedModelProvider(provider)).toBe(true);
      expect(isSupportedModelProvider(`  ${provider}  `)).toBe(true);
    }
  });

  it("rejects unknown providers", () => {
    expect(isSupportedModelProvider("made-up")).toBe(false);
    expect(isSupportedModelProvider("")).toBe(false);
  });

  it("keeps agent validation in lockstep with the canonical list", () => {
    expect([...SUPPORTED_MODEL_PROVIDERS]).toEqual([...MODEL_PROVIDERS]);
  });

  it("no validation/factory drift: every supported provider has a runner", () => {
    for (const provider of MODEL_PROVIDERS) {
      expect(() => createRunner(provider)).not.toThrow();
    }
  });

  it("the factory rejects providers outside the canonical list", () => {
    expect(() => createRunner("made-up")).toThrow(/Unknown model provider/);
  });
});
