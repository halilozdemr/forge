/**
 * Token-cost estimation for metered providers. Pure and data-driven so it can
 * be unit-tested in isolation and kept in one place as new backends are added.
 *
 * Rates are USD per 1,000,000 tokens. CLI/local/subscription backends
 * (claude-cli, gemini-cli, codex-cli, opencode-cli, ollama, cursor) are not
 * metered by Forge and resolve to $0 — their cost lives outside the runtime.
 */

export interface ModelRate {
  /** USD per 1M input tokens. */
  input: number;
  /** USD per 1M output tokens. */
  output: number;
}

interface ProviderPricing {
  /** First entry whose patterns match the (lowercased) model name wins. */
  rates: Array<{ match: string[]; rate: ModelRate }>;
  /** Fallback rate when no pattern matches. */
  fallback?: ModelRate;
}

/**
 * Per-provider price tables. Only metered API providers appear here; anything
 * absent (or matching nothing without a fallback) is treated as $0.
 */
const PRICING: Record<string, ProviderPricing> = {
  "anthropic-api": {
    rates: [
      { match: ["opus"], rate: { input: 15, output: 75 } },
      { match: ["sonnet"], rate: { input: 3, output: 15 } },
      { match: ["haiku"], rate: { input: 0.25, output: 1.25 } },
    ],
    fallback: { input: 3, output: 15 },
  },
  openrouter: {
    // Aggregator with per-model pricing Forge does not enumerate; use a
    // conservative blended estimate.
    rates: [],
    fallback: { input: 1, output: 3 },
  },
  openai: {
    rates: [
      { match: ["gpt-4o-mini"], rate: { input: 0.15, output: 0.6 } },
      { match: ["gpt-4o", "chatgpt-4o"], rate: { input: 2.5, output: 10 } },
      { match: ["o3-mini"], rate: { input: 1.1, output: 4.4 } },
      { match: ["o1-mini"], rate: { input: 1.1, output: 4.4 } },
      { match: ["o3"], rate: { input: 2, output: 8 } },
      { match: ["o1"], rate: { input: 15, output: 60 } },
      { match: ["gpt-4-turbo"], rate: { input: 10, output: 30 } },
      { match: ["gpt-4"], rate: { input: 30, output: 60 } },
      { match: ["gpt-3.5"], rate: { input: 0.5, output: 1.5 } },
    ],
    fallback: { input: 2.5, output: 10 },
  },
  "gemini-api": {
    rates: [
      { match: ["flash-lite"], rate: { input: 0.05, output: 0.2 } },
      { match: ["flash"], rate: { input: 0.1, output: 0.4 } },
      { match: ["pro"], rate: { input: 1.25, output: 5 } },
    ],
    fallback: { input: 1.25, output: 5 },
  },
};

/** Resolve the USD-per-1M rate for a provider/model pair, or null if unmetered. */
export function resolveRate(provider: string, model: string): ModelRate | null {
  const config = PRICING[provider.trim()];
  if (!config) return null;

  const normalized = model.trim().toLowerCase();
  for (const entry of config.rates) {
    if (entry.match.some((token) => normalized.includes(token))) {
      return entry.rate;
    }
  }
  return config.fallback ?? null;
}

/** Estimate the USD cost of a single job's token usage. */
export function estimateCost(
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const rate = resolveRate(provider, model);
  if (!rate) return 0;
  const input = Math.max(0, inputTokens);
  const output = Math.max(0, outputTokens);
  return (input * rate.input + output * rate.output) / 1_000_000;
}

/** Providers Forge meters for budget/cost tracking. */
export const METERED_PROVIDERS = Object.keys(PRICING);
