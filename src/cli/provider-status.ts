import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

/**
 * Provider availability for the conductor routing view.
 *
 * Forge routes each agent to a `modelProvider` backend (a coding CLI, a direct
 * API, or an HTTP endpoint). This module answers a single question for the CLI:
 * is the backend a given agent is wired to actually usable on this machine?
 *
 * The pure mapping + resolution functions are kept free of I/O so they can be
 * unit tested; `defaultProbes()` supplies the real CLI/env detection.
 */

export type ProviderKind = "cli" | "env" | "endpoint" | "local";

export interface ProviderRequirement {
  kind: ProviderKind;
  /** Executable that must be on PATH for `cli` providers. */
  cli?: string;
  /** Any one of these env vars satisfies an `env` provider. */
  envVars?: string[];
  label: string;
}

/**
 * What each backend needs to run. Bins and env var names mirror the actual
 * runner implementations in src/bridge/runners/.
 */
const REQUIREMENTS: Record<string, ProviderRequirement> = {
  "claude-cli": { kind: "cli", cli: "claude", label: "Claude Code CLI" },
  "gemini-cli": { kind: "cli", cli: "gemini", label: "Gemini CLI" },
  "codex-cli": { kind: "cli", cli: "codex", label: "Codex CLI" },
  "opencode-cli": { kind: "cli", cli: "opencode", label: "opencode CLI" },
  "anthropic-api": { kind: "env", envVars: ["ANTHROPIC_API_KEY"], label: "Anthropic API" },
  "openrouter": { kind: "env", envVars: ["OPENROUTER_API_KEY"], label: "OpenRouter API" },
  "gemini-api": { kind: "env", envVars: ["GOOGLE_AI_API_KEY"], label: "Gemini API" },
  "ollama": { kind: "endpoint", label: "Ollama endpoint" },
  "cursor": { kind: "endpoint", label: "Cursor endpoint" },
  "http": { kind: "endpoint", label: "Custom HTTP endpoint" },
  "process": { kind: "local", label: "Local process" },
};

/** Resolve the requirement for a provider, defaulting unknown ones to a neutral endpoint. */
export function providerRequirement(provider: string): ProviderRequirement {
  return REQUIREMENTS[provider] ?? { kind: "endpoint", label: provider };
}

export type AvailabilityStatus = "ready" | "missing" | "unknown";

export interface ProviderAvailability {
  provider: string;
  status: AvailabilityStatus;
  detail: string;
}

export interface AvailabilityProbes {
  hasCli: (bin: string) => boolean;
  hasEnv: (name: string) => boolean;
}

/**
 * Decide whether a provider is usable given injected probes.
 *
 * - `cli` backends are `ready`/`missing` based on whether the binary is found.
 * - `env` backends are `ready`/`missing` based on whether a key is present.
 * - `endpoint`/`local` backends can't be statically verified, so they are
 *   reported as `unknown` (we don't claim a remote endpoint is up or down).
 */
export function resolveProviderAvailability(
  provider: string,
  probes: AvailabilityProbes,
): ProviderAvailability {
  const req = providerRequirement(provider);

  switch (req.kind) {
    case "cli":
      return probes.hasCli(req.cli!)
        ? { provider, status: "ready", detail: `${req.cli} found on PATH` }
        : { provider, status: "missing", detail: `${req.cli} not installed` };
    case "env": {
      const present = (req.envVars ?? []).find((v) => probes.hasEnv(v));
      return present
        ? { provider, status: "ready", detail: `${present} set` }
        : { provider, status: "missing", detail: `${(req.envVars ?? []).join(" / ")} not set` };
    }
    case "endpoint":
    case "local":
    default:
      return { provider, status: "unknown", detail: req.label };
  }
}

const ENV_TO_CONFIG_KEY: Record<string, string> = {
  ANTHROPIC_API_KEY: "anthropicApi",
  OPENROUTER_API_KEY: "openrouter",
  GOOGLE_AI_API_KEY: "geminiApi",
};

function configHasKey(envVar: string): boolean {
  const configKey = ENV_TO_CONFIG_KEY[envVar];
  if (!configKey) return false;
  try {
    const configPath = join(process.cwd(), ".forge", "config.json");
    if (!existsSync(configPath)) return false;
    const cfg = JSON.parse(readFileSync(configPath, "utf-8"));
    return Boolean(cfg.providers?.[configKey]?.apiKey);
  } catch {
    return false;
  }
}

/** Real CLI/env detection. Env keys count whether set in the shell or in .forge/config.json. */
export function defaultProbes(): AvailabilityProbes {
  return {
    hasCli: (bin) => {
      try {
        execSync(`command -v ${bin}`, { stdio: "ignore" });
        return true;
      } catch {
        return false;
      }
    },
    hasEnv: (name) => Boolean(process.env[name]) || configHasKey(name),
  };
}

/** Resolve availability for many providers, probing each distinct provider once. */
export function resolveProvidersAvailability(
  providers: string[],
  probes: AvailabilityProbes = defaultProbes(),
): Map<string, ProviderAvailability> {
  const result = new Map<string, ProviderAvailability>();
  for (const provider of providers) {
    if (!result.has(provider)) {
      result.set(provider, resolveProviderAvailability(provider, probes));
    }
  }
  return result;
}
