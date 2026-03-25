import { existsSync } from "fs";
import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import matter from "gray-matter";
import type { PrismaClient } from "@prisma/client";
import type { CustomAgentDef, ProviderStrategy } from "../db/seed.js";
import { createChildLogger } from "../utils/logger.js";
import {
  buildDefaultClientConfigForSlug,
  OFFICIAL_AGENT_PROMPT_DIR,
  OFFICIAL_AGENT_SLUGS,
  OFFICIAL_ENTRY_AGENT_SLUG,
  isOfficialAgentSlug,
} from "../agents/constants.js";

const log = createChildLogger("opencode-project-config");

const DEFAULT_AGENT_ORDER = [...OFFICIAL_AGENT_SLUGS] as const;

const HEAVY_AGENT_SLUGS = new Set(["architect", "quality-guard"]);

const DEFAULT_AGENT_METADATA: Record<string, { name: string; description: string }> = {
  "intake-gate": {
    name: "Intake Gate",
    description: "Stage-1 intake normalization and execution_brief generation.",
  },
  architect: {
    name: "Architect",
    description: "Stage-2 architecture_plan generation.",
  },
  builder: {
    name: "Builder",
    description: "Stage-3 implementation into work_result.",
  },
  "quality-guard": {
    name: "Quality Guard",
    description: "Stage-4 validation and quality gate.",
  },
  devops: {
    name: "DevOps",
    description: "Optional operational readiness and release artifacts.",
  },
  "retrospective-analyst": {
    name: "Retrospective Analyst",
    description: "Optional learning_report generation.",
  },
};

const MANIFEST_FILENAME = ".forge-generated.json";

interface ForgeInitConfigLike {
  project?: {
    path?: string;
  };
  agentStrategy?: ProviderStrategy;
  agents?: CustomAgentDef[];
}

interface OpenCodeAgentDefinition {
  slug: string;
  name: string;
  description: string;
  modelProvider: string;
  model: string;
  permissions?: Record<string, boolean>;
  reportsTo?: string | null;
  heartbeatCron?: string | null;
}

interface ClientProjectionConfig {
  visibleIn: string[];
  opencodeMode: "primary" | "subagent";
  displayOrder: number;
  entrypoint: boolean;
}

function toForgeModelId(provider: string, model: string): string {
  return `${provider}/${model}`;
}

function toOpenCodeModel(provider: string, model: string): string {
  return `forge/${toForgeModelId(provider, model)}`;
}

function normalizePermissionValue(value: unknown): "allow" | "deny" {
  return value === true || value === "allow" ? "allow" : "deny";
}

function normalizePermissions(permissions?: Record<string, unknown>): Record<string, "allow" | "deny"> {
  const normalized: Record<string, "allow" | "deny"> = {};
  for (const [key, value] of Object.entries(permissions ?? {})) {
    normalized[key] = normalizePermissionValue(value);
  }
  return normalized;
}

function buildDefaultAgents(strategy?: ProviderStrategy): OpenCodeAgentDefinition[] {
  if (!strategy) return [];

  return DEFAULT_AGENT_ORDER.map((slug) => {
    const tier = HEAVY_AGENT_SLUGS.has(slug) ? strategy.heavy : strategy.light;
    const meta = DEFAULT_AGENT_METADATA[slug];

    return {
      slug,
      name: meta.name,
      description: meta.description,
      modelProvider: tier.provider,
      model: tier.model,
    };
  });
}

function resolveConfiguredAgents(config: ForgeInitConfigLike): OpenCodeAgentDefinition[] {
  if (Array.isArray(config.agents) && config.agents.length > 0) {
    return config.agents.map((agent) => ({
      slug: agent.slug,
      name: agent.name,
      description: agent.role,
      modelProvider: agent.modelProvider,
      model: agent.model,
      permissions: agent.permissions,
      reportsTo: agent.reportsTo,
      heartbeatCron: agent.heartbeatCron,
    }));
  }

  return buildDefaultAgents(config.agentStrategy);
}

async function loadTemplateContent(slug: string): Promise<string | null> {
  const globalTemplatePath = join(homedir(), ".config", "opencode", "agents", `${slug}.md`);
  if (existsSync(globalTemplatePath)) {
    return readFile(globalTemplatePath, "utf-8");
  }

  const repoTemplatePath = join(OFFICIAL_AGENT_PROMPT_DIR, `${slug}.md`);
  if (!existsSync(repoTemplatePath)) {
    return null;
  }

  return readFile(repoTemplatePath, "utf-8");
}

function buildFallbackTemplate(agent: OpenCodeAgentDefinition): string {
  const mode = agent.slug === OFFICIAL_ENTRY_AGENT_SLUG ? "primary" : "subagent";
  const permission = normalizePermissions(agent.permissions);
  const frontmatter = {
    id: agent.slug,
    name: agent.name,
    description: agent.description,
    model: toOpenCodeModel(agent.modelProvider, agent.model),
    mode,
    temperature: 0.2,
    ...(agent.reportsTo !== undefined ? { reportsTo: agent.reportsTo } : {}),
    ...(agent.heartbeatCron !== undefined ? { heartbeatCron: agent.heartbeatCron } : {}),
    permission,
  };

  const body = [
    `You are ${agent.name}.`,
    agent.description ? `Your role: ${agent.description}` : "",
    "",
    "Follow the project instructions in OPENCODE.md and the local .opencode context files.",
  ].filter(Boolean).join("\n");

  return matter.stringify(`${body}\n`, frontmatter);
}

function applyTemplateOverrides(
  templateContent: string,
  agent: OpenCodeAgentDefinition,
): string {
  const parsed = matter(templateContent);
  const templateData = (parsed.data ?? {}) as Record<string, unknown>;
  const permission =
    typeof templateData.permission === "object" && templateData.permission !== null
      ? normalizePermissions(templateData.permission as Record<string, unknown>)
      : normalizePermissions(agent.permissions);

  const frontmatter = {
    id: agent.slug,
    name: typeof templateData.name === "string" ? templateData.name : agent.name,
    description:
      typeof templateData.description === "string" ? templateData.description : agent.description,
    model: toOpenCodeModel(agent.modelProvider, agent.model),
    mode:
      typeof templateData.mode === "string"
        ? templateData.mode
        : agent.slug === OFFICIAL_ENTRY_AGENT_SLUG
          ? "primary"
          : "subagent",
    temperature:
      typeof templateData.temperature === "number" ? templateData.temperature : 0.2,
    ...(templateData.reportsTo !== undefined
      ? { reportsTo: templateData.reportsTo }
      : agent.reportsTo !== undefined
        ? { reportsTo: agent.reportsTo }
        : {}),
    ...(templateData.heartbeatCron !== undefined
      ? { heartbeatCron: templateData.heartbeatCron }
      : agent.heartbeatCron !== undefined
        ? { heartbeatCron: agent.heartbeatCron }
        : {}),
    permission,
  };

  return matter.stringify(parsed.content.trimEnd() + "\n", frontmatter);
}

function buildForgeProviderModels(agents: OpenCodeAgentDefinition[]) {
  const uniqueModelIds = new Map<string, { name: string; limit: { context: number; output: number } }>();

  for (const agent of agents) {
    const modelId = toForgeModelId(agent.modelProvider, agent.model);
    if (!uniqueModelIds.has(modelId)) {
      uniqueModelIds.set(modelId, {
        name: `${agent.modelProvider} / ${agent.model}`,
        limit: {
          context: 200000,
          output: 64000,
        },
      });
    }
  }

  return Object.fromEntries(uniqueModelIds.entries());
}

async function readManifest(manifestPath: string): Promise<string[]> {
  if (!existsSync(manifestPath)) return [];

  try {
    const raw = await readFile(manifestPath, "utf-8");
    const parsed = JSON.parse(raw) as { slugs?: string[] };
    return Array.isArray(parsed.slugs) ? parsed.slugs : [];
  } catch (err) {
    log.warn({ err, manifestPath }, "Failed to read OpenCode manifest");
    return [];
  }
}

export async function syncProjectOpenCodeConfig(config: ForgeInitConfigLike): Promise<void> {
  const projectPath = config.project?.path;
  if (!projectPath) {
    log.warn("Skipping OpenCode sync because project path is missing");
    return;
  }

  const agents = resolveConfiguredAgents(config);
  if (agents.length === 0) {
    log.info({ projectPath }, "Skipping OpenCode sync because no agents are configured");
    return;
  }

  const opencodeDir = join(projectPath, ".opencode");
  const agentDir = join(opencodeDir, "agents");
  const manifestPath = join(agentDir, MANIFEST_FILENAME);
  await mkdir(agentDir, { recursive: true });

  const previousManagedSlugs = new Set(await readManifest(manifestPath));
  const currentSlugs = new Set(agents.map((agent) => agent.slug));

  for (const slug of previousManagedSlugs) {
    if (currentSlugs.has(slug)) continue;
    const stalePath = join(agentDir, `${slug}.md`);
    if (!existsSync(stalePath)) continue;
    await unlink(stalePath).catch((err) => {
      log.warn({ err, stalePath }, "Failed to remove stale OpenCode agent override");
    });
  }

  for (const agent of agents) {
    const templateContent = await loadTemplateContent(agent.slug);
    const output = templateContent
      ? applyTemplateOverrides(templateContent, agent)
      : buildFallbackTemplate(agent);
    const targetPath = join(agentDir, `${agent.slug}.md`);
    await writeFile(targetPath, output);
  }

  await writeFile(
    manifestPath,
    JSON.stringify({ slugs: agents.map((agent) => agent.slug) }, null, 2) + "\n",
  );

  const opencodeConfigPath = join(opencodeDir, "opencode.json");
  let existingConfig: Record<string, unknown> = {};
  if (existsSync(opencodeConfigPath)) {
    try {
      existingConfig = JSON.parse(await readFile(opencodeConfigPath, "utf-8")) as Record<string, unknown>;
    } catch (err) {
      log.warn({ err, opencodeConfigPath }, "Failed to parse existing project OpenCode config");
    }
  }

  const provider = typeof existingConfig.provider === "object" && existingConfig.provider !== null
    ? { ...(existingConfig.provider as Record<string, unknown>) }
    : {};

  provider.forge = {
    npm: "@ai-sdk/openai-compatible",
    options: {
      baseURL: "http://localhost:3131/v1",
      apiKey: "local",
    },
    models: buildForgeProviderModels(agents),
  };

  const nextConfig: Record<string, unknown> = {
    ...existingConfig,
    $schema: "https://opencode.ai/config.json",
    provider,
  };

  const mcp = typeof existingConfig.mcp === "object" && existingConfig.mcp !== null
    ? { ...(existingConfig.mcp as Record<string, unknown>) }
    : {};

  mcp.forge = {
    command: ["npx", "tsx", join(projectPath, "v3", "bin", "forge-mcp.ts")],
    enabled: true,
    type: "local",
  };

  nextConfig.mcp = mcp;

  if (agents.some((agent) => agent.slug === OFFICIAL_ENTRY_AGENT_SLUG)) {
    nextConfig.default_agent = OFFICIAL_ENTRY_AGENT_SLUG;
  }

  await writeFile(opencodeConfigPath, JSON.stringify(nextConfig, null, 2) + "\n");

  log.info(
    {
      projectPath,
      agentCount: agents.length,
      providerModels: Object.keys(buildForgeProviderModels(agents)),
    },
    "Synchronized project-local OpenCode configuration",
  );
}

function defaultClientProjectionConfig(slug: string): ClientProjectionConfig {
  const fallbackNamespace = isOfficialAgentSlug(slug) ? "official" : "user";
  const base = buildDefaultClientConfigForSlug(slug, fallbackNamespace);
  const isKnownDefaultAgent = DEFAULT_AGENT_ORDER.includes(slug as (typeof DEFAULT_AGENT_ORDER)[number]);

  return {
    visibleIn: isKnownDefaultAgent ? ["claude-code", "opencode"] : base.visibleIn,
    opencodeMode: base.opencodeMode,
    displayOrder: base.displayOrder,
    entrypoint: base.entrypoint,
  };
}

function parseClientProjectionConfig(slug: string, raw: string | null | undefined): ClientProjectionConfig {
  if (!raw) return defaultClientProjectionConfig(slug);

  try {
    const parsed = JSON.parse(raw) as Partial<ClientProjectionConfig>;
    return {
      ...defaultClientProjectionConfig(slug),
      ...parsed,
      visibleIn: Array.isArray(parsed.visibleIn)
        ? parsed.visibleIn
        : defaultClientProjectionConfig(slug).visibleIn,
    };
  } catch {
    return defaultClientProjectionConfig(slug);
  }
}

function buildClientProjectionFrontmatter(agent: OpenCodeAgentDefinition, config: ClientProjectionConfig) {
  return {
    id: agent.slug,
    name: agent.name,
    description: agent.description,
    model: toOpenCodeModel(agent.modelProvider, agent.model),
    mode: config.opencodeMode,
    temperature: agent.slug === OFFICIAL_ENTRY_AGENT_SLUG ? 0.2 : 0.1,
    permission: {
      read: "allow",
      grep: "allow",
      glob: "allow",
      edit: "deny",
      write: "deny",
      bash: "deny",
      task: "deny",
    },
  };
}

function renderIntakeProjection(agent: OpenCodeAgentDefinition): string {
  const body = [
    "You are the Intake Gate projection for Forge.",
    "You are an intake-only projection. Never implement locally and never orchestrate locally.",
    "",
    "Rules:",
    "- Gather request context and use intake-first handling.",
    "- For feature, bug, refactor, or release requests, call `forge_submit_request`.",
    "- After backend submission, immediately call `forge_get_pipeline` and report the active stage.",
    "- If the pipeline is still running, call `forge_wait_pipeline` once before replying so the user sees the freshest active step.",
    "- If the user asks to keep watching progress, continue looping with `forge_wait_pipeline` and report each step transition.",
    "- Never call local orchestration patterns or local task chaining.",
    "",
    "When calling `forge_submit_request`, include:",
    "- `source`: `opencode`",
    "- `type`: one of `feature`, `bug`, `refactor`, `release`",
    "- `title`: short user-facing title",
    "- `description`: concise execution request",
    "- `briefMarkdown`: optional user-confirmed brief",
    "- `requestedBy`: `user`",
  ].join("\n");

  return matter.stringify(`${body}\n`, buildClientProjectionFrontmatter(agent, defaultClientProjectionConfig(agent.slug)));
}

function renderCapabilityProjection(agent: OpenCodeAgentDefinition, config: ClientProjectionConfig): string {
  const body = [
    `You are the ${agent.name} capability projection for Forge.`,
    "You do not execute official runs directly.",
    "",
    "Rules:",
    "- Enforce intake-first. Use `forge_submit_request` instead of direct specialist run.",
    "- Treat this projection as capability preference metadata only.",
    "- Never bypass intake with `forge_run_agent_direct`.",
    "- Never orchestrate locally.",
    "- If request is out of scope, ask user to submit through intake with corrected type/scope.",
  ].join("\n");

  return matter.stringify(`${body}\n`, buildClientProjectionFrontmatter(agent, config));
}

function renderClaudeProjection(
  agents: Array<OpenCodeAgentDefinition & { clientConfig: ClientProjectionConfig }>,
): string {
  const visible = agents
    .filter((agent) => agent.clientConfig.visibleIn.includes("claude-code"))
    .sort((a, b) => a.clientConfig.displayOrder - b.clientConfig.displayOrder);

  const rows = visible
    .map((agent) => `| ${agent.slug} | ${agent.name} | ${agent.modelProvider}/${agent.model} |`)
    .join("\n");

  return [
    "# Claude Projection",
    "",
    "This file is generated from the Forge agent registry.",
    "Claude Code should use Forge MCP tools as the orchestration plane.",
    "",
    "## Visible Agents",
    "",
    "| slug | name | model |",
    "| --- | --- | --- |",
    rows || "| none | none | none |",
    "",
    "## Runtime Rules",
    "",
    "- Use `forge_submit_request` for all official request types (intake-first).",
    "- Direct specialist runs are non-authoritative and disabled by default for official flow.",
    "- Use `forge_get_pipeline`, `forge_wait_pipeline`, and `forge_list_pipeline_steps` for status checks and progress follow-up.",
    "- Keep orchestration in the Forge backend; do not simulate handoffs locally.",
  ].join("\n");
}

export async function syncProjectClientProjectionsFromRegistry(opts: {
  db: PrismaClient;
  companyId: string;
  projectPath: string;
}): Promise<void> {
  const registryAgents = await opts.db.agent.findMany({
    where: { companyId: opts.companyId },
    orderBy: { slug: "asc" },
  });

  const allAgents = registryAgents.map((agent) => ({
      slug: agent.slug,
      name: agent.name,
      description: agent.role,
      modelProvider: agent.modelProvider,
      model: agent.model,
      permissions: JSON.parse(agent.permissions || "{}") as Record<string, boolean>,
      reportsTo: agent.reportsTo,
      heartbeatCron: agent.heartbeatCron,
      clientConfig: parseClientProjectionConfig(agent.slug, agent.clientConfig),
    }));

  const opencodeAgents = allAgents
    .filter((agent) => agent.clientConfig.visibleIn.includes("opencode"))
    .sort((a, b) => a.clientConfig.displayOrder - b.clientConfig.displayOrder);

  const opencodeDir = join(opts.projectPath, ".opencode");
  const agentDir = join(opencodeDir, "agents");
  const manifestPath = join(agentDir, MANIFEST_FILENAME);
  await mkdir(agentDir, { recursive: true });

  const previousManagedSlugs = new Set(await readManifest(manifestPath));
  const currentSlugs = new Set(opencodeAgents.map((agent) => agent.slug));

  for (const slug of previousManagedSlugs) {
    if (currentSlugs.has(slug)) continue;
    const stalePath = join(agentDir, `${slug}.md`);
    if (existsSync(stalePath)) {
      await unlink(stalePath).catch((err) => {
        log.warn({ err, stalePath }, "Failed to remove stale projected OpenCode agent");
      });
    }
  }

  for (const agent of opencodeAgents) {
    const content = agent.slug === OFFICIAL_ENTRY_AGENT_SLUG
      ? renderIntakeProjection(agent)
      : renderCapabilityProjection(agent, agent.clientConfig);
    await writeFile(join(agentDir, `${agent.slug}.md`), content);
  }

  await writeFile(
    manifestPath,
    JSON.stringify({ slugs: opencodeAgents.map((agent) => agent.slug) }, null, 2) + "\n",
  );

  const opencodeConfigPath = join(opencodeDir, "opencode.json");
  let existingConfig: Record<string, unknown> = {};
  if (existsSync(opencodeConfigPath)) {
    try {
      existingConfig = JSON.parse(await readFile(opencodeConfigPath, "utf-8")) as Record<string, unknown>;
    } catch (err) {
      log.warn({ err, opencodeConfigPath }, "Failed to parse project OpenCode config before registry sync");
    }
  }

  const provider = typeof existingConfig.provider === "object" && existingConfig.provider !== null
    ? { ...(existingConfig.provider as Record<string, unknown>) }
    : {};

  provider.forge = {
    npm: "@ai-sdk/openai-compatible",
    options: {
      baseURL: "http://localhost:3131/v1",
      apiKey: "local",
    },
    models: buildForgeProviderModels(opencodeAgents),
  };

  const nextConfig: Record<string, unknown> = {
    ...existingConfig,
    $schema: "https://opencode.ai/config.json",
    provider,
    default_agent: opencodeAgents.some((agent) => agent.slug === OFFICIAL_ENTRY_AGENT_SLUG)
      ? OFFICIAL_ENTRY_AGENT_SLUG
      : existingConfig.default_agent,
  };

  const mcp = typeof existingConfig.mcp === "object" && existingConfig.mcp !== null
    ? { ...(existingConfig.mcp as Record<string, unknown>) }
    : {};

  mcp.forge = {
    command: ["npx", "tsx", join(opts.projectPath, "v3", "bin", "forge-mcp.ts")],
    enabled: true,
    type: "local",
  };

  nextConfig.mcp = mcp;

  await writeFile(opencodeConfigPath, JSON.stringify(nextConfig, null, 2) + "\n");

  const claudeContextDir = join(opts.projectPath, ".forge", "context");
  await mkdir(claudeContextDir, { recursive: true });
  await writeFile(
    join(claudeContextDir, "claude-projection.md"),
    renderClaudeProjection(allAgents) + "\n",
  );

  log.info(
    {
      projectPath: opts.projectPath,
      agentCount: allAgents.length,
      opencodeAgentCount: opencodeAgents.length,
    },
    "Synchronized client projections from Forge registry",
  );
}
