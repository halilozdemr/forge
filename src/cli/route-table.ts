/**
 * Pure helpers for the `forge route` command: turning agent records into a
 * stage→backend routing table, resolving per-stage assignments, and expanding
 * heavy/light presets. Kept free of I/O so the logic is unit-testable; the
 * command module supplies live env/PATH probes and HTTP calls.
 */

import {
  getProvider,
  isRoutableProvider,
  defaultModelFor,
  listRoutableProviders,
} from "../bridge/runners/providers.js";

export interface RouteRow {
  slug: string;
  name: string;
  provider: string;
  model: string;
}

export interface ProviderProbe {
  /** Returns the value of an env var, or undefined when unset/empty. */
  getEnv: (name: string) => string | undefined;
  /** Returns true when a CLI binary is resolvable on PATH. */
  hasBinary: (name: string) => boolean;
}

export type AvailabilityStatus = "available" | "missing" | "unknown";

export interface AvailabilityResult {
  status: AvailabilityStatus;
  detail: string;
}

/**
 * Best-effort assessment of whether a provider's backend is reachable, based on
 * env vars and CLI binaries. Never performs network calls — "unknown" is used
 * when reachability can only be confirmed at run time.
 */
export function providerAvailability(id: string, probe: ProviderProbe): AvailabilityResult {
  const descriptor = getProvider(id);
  if (!descriptor) {
    return { status: "missing", detail: "unknown provider" };
  }

  if (descriptor.apiKeyEnv) {
    return probe.getEnv(descriptor.apiKeyEnv)
      ? { status: "available", detail: `${descriptor.apiKeyEnv} set` }
      : { status: "missing", detail: `${descriptor.apiKeyEnv} not set` };
  }

  if (descriptor.cliBinary) {
    if (descriptor.cliPathEnv && probe.getEnv(descriptor.cliPathEnv)) {
      return { status: "available", detail: `via ${descriptor.cliPathEnv}` };
    }
    return probe.hasBinary(descriptor.cliBinary)
      ? { status: "available", detail: `${descriptor.cliBinary} on PATH` }
      : { status: "missing", detail: `${descriptor.cliBinary} not found` };
  }

  if (descriptor.baseUrlEnv) {
    return probe.getEnv(descriptor.baseUrlEnv)
      ? { status: "available", detail: `via ${descriptor.baseUrlEnv}` }
      : { status: "unknown", detail: "defaults to localhost" };
  }

  return { status: "unknown", detail: "verified at run time" };
}

/**
 * Resolve a single stage assignment, filling in the provider's default model
 * when none is supplied. Throws if the provider is not a routable backend.
 */
export function resolveRouteAssignment(
  provider: string,
  model?: string,
): { provider: string; model: string } {
  const id = provider.trim();
  if (!isRoutableProvider(id)) {
    const detail = getProvider(id)
      ? "is an internal bridge, not a routing target"
      : "is not a known provider";
    throw new Error(`Provider "${id}" ${detail}`);
  }

  const resolvedModel = model?.trim() || defaultModelFor(id);
  if (!resolvedModel) {
    throw new Error(`No model supplied and no default model for provider "${id}"`);
  }
  return { provider: id, model: resolvedModel };
}

export interface ProviderChoice {
  value: string;
  label: string;
  hint: string;
}

/**
 * Build interactive picker options for the routable providers, annotated with
 * each backend's default model and current availability.
 */
export function buildProviderChoices(probe: ProviderProbe): ProviderChoice[] {
  return listRoutableProviders().map((descriptor) => {
    const availability = providerAvailability(descriptor.id, probe);
    return {
      value: descriptor.id,
      label: `${descriptor.id} (${descriptor.label})`,
      hint: `${availability.status} · default ${descriptor.defaultModel}`,
    };
  });
}

export interface ProviderTier {
  provider: string;
  model: string;
}

export interface ProviderStrategyLike {
  heavy: ProviderTier;
  light: ProviderTier;
}

/**
 * Whether both tiers of a preset target routable backends, i.e. whether the
 * preset can actually be applied without hitting a provider that has no runner.
 */
export function presetIsApplicable(strategy: ProviderStrategyLike): boolean {
  return isRoutableProvider(strategy.heavy.provider) && isRoutableProvider(strategy.light.provider);
}

export interface PresetAssignment {
  slug: string;
  provider: string;
  model: string;
  tier: "heavy" | "light";
}

/**
 * Expand a heavy/light preset into a concrete per-stage assignment list for the
 * given agents. Validates that both tiers point at routable backends so a
 * broken preset (e.g. one referencing a provider with no runner) is rejected
 * before any agent is mutated.
 */
export function resolvePresetAssignments(
  strategy: ProviderStrategyLike,
  agents: Array<{ slug: string }>,
  heavyAgents: string[],
): PresetAssignment[] {
  for (const tier of ["heavy", "light"] as const) {
    const { provider } = strategy[tier];
    if (!isRoutableProvider(provider)) {
      throw new Error(
        `Preset ${tier} tier targets "${provider}", which is not a routable provider`,
      );
    }
  }

  const heavy = new Set(heavyAgents);
  return agents.map((agent) => {
    const tier: "heavy" | "light" = heavy.has(agent.slug) ? "heavy" : "light";
    const choice = strategy[tier];
    return {
      slug: agent.slug,
      provider: choice.provider,
      model: choice.model,
      tier,
    };
  });
}

/** Canonical pipeline order used to display stages top-to-bottom. */
export const STAGE_ORDER = [
  "intake-gate",
  "architect",
  "builder",
  "quality-guard",
  "devops",
  "retrospective-analyst",
  "planner",
  "harness-builder",
  "evaluator",
];

/**
 * Order rows by pipeline position, with any unrecognised (custom) agents kept
 * after the known stages in alphabetical order.
 */
export function sortRouteRows(rows: RouteRow[]): RouteRow[] {
  const index = new Map(STAGE_ORDER.map((slug, i) => [slug, i]));
  return [...rows].sort((a, b) => {
    const ai = index.get(a.slug) ?? Number.MAX_SAFE_INTEGER;
    const bi = index.get(b.slug) ?? Number.MAX_SAFE_INTEGER;
    if (ai !== bi) return ai - bi;
    return a.slug.localeCompare(b.slug);
  });
}

const AVAILABILITY_GLYPH: Record<AvailabilityStatus, string> = {
  available: "ready",
  missing: "missing",
  unknown: "runtime",
};

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

/**
 * Render the routing table as plain text lines (no ANSI), one row per stage.
 * The caller is responsible for any colouring.
 */
export function formatRouteTable(rows: RouteRow[], probe: ProviderProbe): string[] {
  if (rows.length === 0) {
    return ["No agents found. Run `forge init` first."];
  }

  const computed = rows.map((row) => {
    const availability = providerAvailability(row.provider, probe);
    return {
      stage: row.slug,
      provider: row.provider,
      model: row.model,
      backend: `${AVAILABILITY_GLYPH[availability.status]} (${availability.detail})`,
    };
  });

  const stageW = Math.max(5, ...computed.map((r) => r.stage.length));
  const providerW = Math.max(8, ...computed.map((r) => r.provider.length));
  const modelW = Math.max(5, ...computed.map((r) => r.model.length));

  const lines: string[] = [];
  lines.push(
    `${pad("STAGE", stageW)}  ${pad("PROVIDER", providerW)}  ${pad("MODEL", modelW)}  BACKEND`,
  );
  lines.push("─".repeat(stageW + providerW + modelW + 6 + 7));
  for (const r of computed) {
    lines.push(
      `${pad(r.stage, stageW)}  ${pad(r.provider, providerW)}  ${pad(r.model, modelW)}  ${r.backend}`,
    );
  }
  return lines;
}
