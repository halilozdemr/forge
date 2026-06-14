import { MODEL_PROVIDERS, isSupportedModelProvider } from "../bridge/runners/providers.js";

const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

/**
 * Supported providers derive from the runner factory's canonical list, so any
 * backend with a runner can be assigned to an agent (no validation/factory drift).
 */
export const SUPPORTED_MODEL_PROVIDERS = MODEL_PROVIDERS;

export { isSupportedModelProvider };

/** Validates model format used by Forge agent definitions. */
export function isValidModel(model: string): boolean {
  const trimmed = model.trim();
  return trimmed.length > 0 && MODEL_PATTERN.test(trimmed);
}
