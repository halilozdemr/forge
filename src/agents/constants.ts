import { existsSync } from "fs";
import { join, resolve } from "path";

export const OFFICIAL_AGENT_SLUGS = [
  "intake-gate",
  "architect",
  "builder",
  "quality-guard",
  "devops",
  "retrospective-analyst",
] as const;

/** Forge V2.1 harness-only agents — not part of classic V1 pipelines or OpenCode init config. */
export const HARNESS_AGENT_SLUGS = [
  "planner",
  "evaluator",
  "harness-builder",
] as const;

/** All built-in agent slugs: classic workflow agents + harness agents. Used for prompt loading and seeding. */
export const ALL_BUILTIN_AGENT_SLUGS = [
  ...OFFICIAL_AGENT_SLUGS,
  ...HARNESS_AGENT_SLUGS,
] as const;

export const OFFICIAL_REQUIRED_PIPELINE = [
  "intake-gate",
  "architect",
  "builder",
  "quality-guard",
] as const;

export const OFFICIAL_OPTIONAL_STAGES = [
  "devops",
  "retrospective-analyst",
] as const;

export const OFFICIAL_ENTRY_AGENT_SLUG = "intake-gate";

export const RESERVED_OFFICIAL_AGENT_SLUGS = new Set<string>(ALL_BUILTIN_AGENT_SLUGS);

function resolveAgentPromptDir(namespace: "official" | "user"): string {
  const candidates = [
    // Source runtime (tsx from repo/src/*)
    resolve(join(import.meta.dirname, "..", "..", "ai-system", namespace, "agents")),
    // Built runtime (node dist/* where module dir is dist/src/*)
    resolve(join(import.meta.dirname, "..", "..", "..", "ai-system", namespace, "agents")),
    // Last-resort fallback to current working directory
    resolve(join(process.cwd(), "ai-system", namespace, "agents")),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  // Keep deterministic behavior even if prompts are missing.
  return candidates[0];
}

export const OFFICIAL_AGENT_PROMPT_DIR = resolveAgentPromptDir("official");
export const USER_AGENT_PROMPT_DIR = resolveAgentPromptDir("user");

export type AgentNamespace = "official" | "user";

export interface AgentClientConfig {
  namespace: AgentNamespace;
  official: boolean;
  pipelineEligible: boolean;
  authoritative: boolean;
  visibleIn: string[];
  opencodeMode: "primary" | "subagent";
  displayOrder: number;
  entrypoint: boolean;
}

export function isOfficialAgentSlug(slug: string): boolean {
  return RESERVED_OFFICIAL_AGENT_SLUGS.has(slug);
}

export function defaultAgentNamespaceForSlug(slug: string): AgentNamespace {
  return isOfficialAgentSlug(slug) ? "official" : "user";
}

export function isHarnessAgentSlug(slug: string): boolean {
  return HARNESS_AGENT_SLUGS.includes(slug as (typeof HARNESS_AGENT_SLUGS)[number]);
}

export function getOfficialAgentDisplayOrder(slug: string): number {
  const idx = OFFICIAL_AGENT_SLUGS.indexOf(slug as (typeof OFFICIAL_AGENT_SLUGS)[number]);
  return idx >= 0 ? idx : 999;
}

export function buildDefaultClientConfigForSlug(slug: string, namespace?: AgentNamespace): AgentClientConfig {
  const effectiveNamespace = namespace ?? defaultAgentNamespaceForSlug(slug);
  const official = effectiveNamespace === "official";
  const harnessOnly = official && isHarnessAgentSlug(slug);

  return {
    namespace: effectiveNamespace,
    official,
    pipelineEligible: official,
    authoritative: official,
    visibleIn: official ? (harnessOnly ? [] : ["claude-code", "opencode"]) : ["claude-code"],
    opencodeMode: slug === OFFICIAL_ENTRY_AGENT_SLUG ? "primary" : "subagent",
    displayOrder: official ? getOfficialAgentDisplayOrder(slug) : 999,
    entrypoint: slug === OFFICIAL_ENTRY_AGENT_SLUG,
  };
}
