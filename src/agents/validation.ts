import { MODEL_PROVIDER_IDS, isKnownProvider } from "../bridge/runners/providers.js";

const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

/**
 * Supported model providers, derived from the single-source runner registry so
 * validation can never drift from what the factory is actually able to run.
 */
export const SUPPORTED_MODEL_PROVIDERS = MODEL_PROVIDER_IDS;

/** Validates whether the provider is one of the supported model providers. */
export function isSupportedModelProvider(provider: string): boolean {
  return isKnownProvider(provider);
}

/** Validates model format used by Forge agent definitions. */
export function isValidModel(model: string): boolean {
  const trimmed = model.trim();
  return trimmed.length > 0 && MODEL_PATTERN.test(trimmed);
}
