/**
 * Canonical list of model-provider backends the conductor can dispatch to.
 *
 * This is the single source of truth. The runner factory, agent validation,
 * and the CLI routing view all derive "what providers are supported" from here,
 * so a backend that has a runner can always be assigned to an agent.
 *
 * Keep this in sync with the switch in `factory.ts` (one entry per runner).
 */
export const MODEL_PROVIDERS = [
  "claude-cli",
  "openrouter",
  "anthropic-api",
  "gemini-cli",
  "gemini-api",
  "codex-cli",
  "opencode-cli",
  "ollama",
  "cursor",
  "http",
  "process",
] as const;

export type ModelProvider = (typeof MODEL_PROVIDERS)[number];

const MODEL_PROVIDER_SET = new Set<string>(MODEL_PROVIDERS);

/** Whether a provider string maps to a runner the factory can construct. */
export function isSupportedModelProvider(provider: string): boolean {
  return MODEL_PROVIDER_SET.has(provider.trim());
}
