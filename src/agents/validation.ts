const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

export const SUPPORTED_MODEL_PROVIDERS = [
  "claude-cli",
  "openrouter",
  "anthropic-api",
  "codex-cli",
  "opencode-cli",
  "gemini-cli",
] as const;

const SUPPORTED_MODEL_PROVIDER_SET = new Set<string>(SUPPORTED_MODEL_PROVIDERS);

/** Validates whether the provider is one of the supported model providers. */
export function isSupportedModelProvider(provider: string): boolean {
  return SUPPORTED_MODEL_PROVIDER_SET.has(provider.trim());
}

/** Validates model format used by Forge agent definitions. */
export function isValidModel(model: string): boolean {
  const trimmed = model.trim();
  return trimmed.length > 0 && MODEL_PATTERN.test(trimmed);
}
