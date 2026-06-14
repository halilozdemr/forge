/**
 * Single source of truth for the coding backends Forge can route pipeline
 * stages to. The runner factory, agent validation, seeding, and the
 * `forge route` command all derive their notion of "what is a valid provider"
 * from this registry so the conductor never advertises a backend it cannot run.
 */

export type ProviderKind = "cli" | "api" | "local" | "internal";

export interface ProviderDescriptor {
  /** Stable id stored in `agent.modelProvider` and dispatched by the factory. */
  id: string;
  /** Human-friendly label for CLI/route output. */
  label: string;
  kind: ProviderKind;
  /** Default model assigned when a route is set without an explicit model. */
  defaultModel: string;
  /**
   * Whether pipeline stages / agents may be routed to this provider. Internal
   * plumbing backends (generic process/http bridges) are runnable but are not
   * offered as routing targets.
   */
  routable: boolean;
  /** Env var holding the API key (api providers). */
  apiKeyEnv?: string;
  /** Executable resolved on PATH for an availability check (cli providers). */
  cliBinary?: string;
  /** Env var that overrides the CLI binary path. */
  cliPathEnv?: string;
  /** Env var pointing at a local/self-hosted base URL (local providers). */
  baseUrlEnv?: string;
}

/**
 * Every backend the runner factory can construct. Ordering is the canonical
 * display order for routing tables and interactive pickers.
 */
export const MODEL_PROVIDERS: ProviderDescriptor[] = [
  {
    id: "claude-cli",
    label: "Claude CLI",
    kind: "cli",
    defaultModel: "sonnet",
    routable: true,
    cliBinary: "claude",
    cliPathEnv: "CLAUDE_CLI_PATH",
  },
  {
    id: "anthropic-api",
    label: "Anthropic API",
    kind: "api",
    defaultModel: "claude-sonnet-4-6",
    routable: true,
    apiKeyEnv: "ANTHROPIC_API_KEY",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    kind: "api",
    defaultModel: "deepseek/deepseek-v3-0324:free",
    routable: true,
    apiKeyEnv: "OPENROUTER_API_KEY",
  },
  {
    id: "openai",
    label: "OpenAI API",
    kind: "api",
    defaultModel: "gpt-4o",
    routable: true,
    apiKeyEnv: "OPENAI_API_KEY",
  },
  {
    id: "gemini-cli",
    label: "Gemini CLI",
    kind: "cli",
    defaultModel: "gemini-2.5-pro",
    routable: true,
    cliBinary: "gemini",
    cliPathEnv: "GEMINI_CLI_PATH",
  },
  {
    id: "gemini-api",
    label: "Gemini API",
    kind: "api",
    defaultModel: "gemini-2.5-pro",
    routable: true,
    apiKeyEnv: "GOOGLE_AI_API_KEY",
  },
  {
    id: "codex-cli",
    label: "Codex CLI",
    kind: "cli",
    defaultModel: "codex-mini-latest",
    routable: true,
    cliBinary: "codex",
    cliPathEnv: "CODEX_CLI_PATH",
  },
  {
    id: "opencode-cli",
    label: "opencode CLI",
    kind: "cli",
    defaultModel: "default",
    routable: true,
    cliBinary: "opencode",
  },
  {
    id: "ollama",
    label: "Ollama",
    kind: "local",
    defaultModel: "llama3.2",
    routable: true,
    baseUrlEnv: "OLLAMA_BASE_URL",
  },
  {
    id: "cursor",
    label: "Cursor Agent",
    kind: "api",
    defaultModel: "default",
    routable: true,
  },
  {
    id: "process",
    label: "Generic process bridge",
    kind: "internal",
    defaultModel: "default",
    routable: false,
  },
  {
    id: "http",
    label: "Generic HTTP bridge",
    kind: "internal",
    defaultModel: "default",
    routable: false,
  },
];

const PROVIDER_BY_ID = new Map<string, ProviderDescriptor>(
  MODEL_PROVIDERS.map((p) => [p.id, p]),
);

/** All provider ids the runner factory can dispatch (routable + internal). */
export const MODEL_PROVIDER_IDS: string[] = MODEL_PROVIDERS.map((p) => p.id);

/** Look up a provider descriptor by id. */
export function getProvider(id: string): ProviderDescriptor | undefined {
  return PROVIDER_BY_ID.get(id.trim());
}

/** Whether the id maps to a backend the factory can construct. */
export function isKnownProvider(id: string): boolean {
  return PROVIDER_BY_ID.has(id.trim());
}

/** Whether the id is a valid routing target for an agent / pipeline stage. */
export function isRoutableProvider(id: string): boolean {
  return PROVIDER_BY_ID.get(id.trim())?.routable === true;
}

/** Providers that may be assigned to pipeline stages, in display order. */
export function listRoutableProviders(): ProviderDescriptor[] {
  return MODEL_PROVIDERS.filter((p) => p.routable);
}

/** Default model for a provider, or undefined if the provider is unknown. */
export function defaultModelFor(id: string): string | undefined {
  return PROVIDER_BY_ID.get(id.trim())?.defaultModel;
}
