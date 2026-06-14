import { describe, expect, it } from "vitest";
import {
  type CostEventLike,
  formatCostGroups,
  groupByAgent,
  groupByProvider,
  groupCostEvents,
} from "../cli/budget-report.js";

const events: CostEventLike[] = [
  { provider: "anthropic-api", agentId: "architect", costUsd: 0.5, inputTokens: 1000, outputTokens: 200 },
  { provider: "openai", agentId: "builder", costUsd: 1.25, inputTokens: 2000, outputTokens: 500 },
  { provider: "anthropic-api", agentId: "builder", costUsd: 0.75, inputTokens: 500, outputTokens: 100 },
  { provider: "claude-cli", agentId: "quality-guard", costUsd: 0, inputTokens: 300, outputTokens: 50 },
];

describe("groupByProvider", () => {
  it("sums usd and tokens per provider", () => {
    const groups = groupByProvider(events);
    const anthropic = groups.find((g) => g.key === "anthropic-api");
    expect(anthropic).toEqual({ key: "anthropic-api", usd: 1.25, tokens: 1800, count: 2 });
  });

  it("sorts by spend descending", () => {
    const groups = groupByProvider(events);
    expect(groups.map((g) => g.key)).toEqual(["anthropic-api", "openai", "claude-cli"]);
  });

  it("breaks usd ties alphabetically by key", () => {
    const tied: CostEventLike[] = [
      { provider: "zeta", agentId: "a", costUsd: 1, inputTokens: 0, outputTokens: 0 },
      { provider: "alpha", agentId: "b", costUsd: 1, inputTokens: 0, outputTokens: 0 },
    ];
    expect(groupByProvider(tied).map((g) => g.key)).toEqual(["alpha", "zeta"]);
  });
});

describe("groupByAgent", () => {
  it("groups across providers by agent", () => {
    const groups = groupByAgent(events);
    const builder = groups.find((g) => g.key === "builder");
    expect(builder).toEqual({ key: "builder", usd: 2, tokens: 3100, count: 2 });
  });
});

describe("groupCostEvents", () => {
  it("collapses blank and missing keys into the fallback", () => {
    const dirty: CostEventLike[] = [
      { provider: "", agentId: "a", costUsd: 1, inputTokens: 0, outputTokens: 0 },
      { provider: null, agentId: "b", costUsd: 2, inputTokens: 0, outputTokens: 0 },
      { agentId: "c", costUsd: 3, inputTokens: 0, outputTokens: 0 },
    ];
    const groups = groupCostEvents(dirty, (e) => e.provider, "unknown");
    expect(groups).toEqual([{ key: "unknown", usd: 6, tokens: 0, count: 3 }]);
  });

  it("coerces string costUsd and tolerates missing token fields", () => {
    const mixed: CostEventLike[] = [
      { provider: "openrouter", agentId: "a", costUsd: "0.5" as unknown as number },
    ];
    expect(groupCostEvents(mixed, (e) => e.provider)).toEqual([
      { key: "openrouter", usd: 0.5, tokens: 0, count: 1 },
    ]);
  });

  it("returns an empty array for no events", () => {
    expect(groupCostEvents([] as CostEventLike[], (e) => e.provider)).toEqual([]);
  });
});

describe("formatCostGroups", () => {
  it("aligns keys to the widest key and formats usd/tokens", () => {
    const lines = formatCostGroups(groupByProvider(events));
    expect(lines[0]).toBe("  anthropic-api  $1.2500  1800 tokens");
    expect(lines[1]).toBe("  openai         $1.2500  2500 tokens");
  });

  it("honors minKeyWidth padding", () => {
    const lines = formatCostGroups([{ key: "x", usd: 1, tokens: 2, count: 1 }], { minKeyWidth: 5 });
    expect(lines[0]).toBe("  x      $1.0000  2 tokens");
  });

  it("returns no lines for empty input", () => {
    expect(formatCostGroups([])).toEqual([]);
  });
});
