import { existsSync } from "fs";
import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import matter from "gray-matter";
import type { PrismaClient } from "@prisma/client";
import type { CustomAgentDef, ProviderStrategy } from "../db/seed.js";
import { createChildLogger } from "../utils/logger.js";

const log = createChildLogger("opencode-project-config");

const DEFAULT_AGENT_ORDER = [
  "receptionist",
  "pm",
  "architect",
  "builder",
  "reviewer",
  "debugger",
  "devops",
  "designer",
  "scrum_master",
] as const;

const HEAVY_AGENT_SLUGS = new Set(["architect", "reviewer", "debugger"]);

const REPO_TEMPLATE_FALLBACKS: Record<string, string> = {
  receptionist: "ceo.md",
  builder: "engineer.md",
  scrum_master: "scrum-master.md",
};

const DEFAULT_AGENT_METADATA: Record<string, { name: string; description: string }> = {
  receptionist: {
    name: "Receptionist",
    description: "Client liaison, request intake, flow routing.",
  },
  pm: {
    name: "Product Manager",
    description: "Sprint planning, task decomposition, backlog management.",
  },
  architect: {
    name: "Lead Architect",
    description: "Technical decisions, architecture design, escalation handler.",
  },
  builder: {
    name: "builder",
    description: "Code implementation.",
  },
  reviewer: {
    name: "reviewer",
    description: "Code review, quality gate.",
  },
  debugger: {
    name: "debugger",
    description: "Bug investigation and hotfix.",
  },
  devops: {
    name: "devops",
    description: "Git workflow, deployment, release automation.",
  },
  designer: {
    name: "designer",
    description: "UI specifications and UX flows.",
  },
  scrum_master: {
    name: "scrum_master",
    description: "Retrospectives and process improvement.",
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

  const fallbackFile = REPO_TEMPLATE_FALLBACKS[slug] ?? `${slug}.md`;
  const repoTemplatePath = join(import.meta.dirname, "..", "agents", "defaults", fallbackFile);
  if (!existsSync(repoTemplatePath)) {
    return null;
  }

  const content = await readFile(repoTemplatePath, "utf-8");
  return content.replaceAll(".forge/", ".opencode/");
}

function buildFallbackTemplate(agent: OpenCodeAgentDefinition): string {
  const mode = agent.slug === "receptionist" ? "primary" : "subagent";
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
        : agent.slug === "receptionist"
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

  if (agents.some((agent) => agent.slug === "receptionist")) {
    nextConfig.default_agent = "receptionist";
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
  const displayOrder = DEFAULT_AGENT_ORDER.findIndex((item) => item === slug);
  const isKnownDefaultAgent = displayOrder >= 0;

  return {
    visibleIn: isKnownDefaultAgent ? ["claude-code", "opencode"] : [],
    opencodeMode: slug === "receptionist" ? "primary" : "subagent",
    displayOrder: displayOrder >= 0 ? displayOrder : 99,
    entrypoint: slug === "receptionist",
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
    temperature: agent.slug === "receptionist" ? 0.2 : 0.1,
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

function renderReceptionistProjection(agent: OpenCodeAgentDefinition): string {
  const body = [
    "You are the Receptionist projection for Forge.",
    "You are an intake layer only. Never implement locally and never orchestrate with local task chaining.",
    "",
    "Rules:",
    "- Gather the request, ask at most 2 clarifying questions when essential.",
    "- For feature, bug, refactor, or release requests, write a brief and get explicit approval.",
    "- After approval, call `forge_submit_request` with source `opencode`.",
    "- For direct specialist requests, call `forge_run_agent_direct` with the requested specialist slug.",
    "- After backend submission, do not stop at issueId. Immediately call `forge_get_pipeline` and report the active backend agent and step.",
    "- If the pipeline is still running, call `forge_wait_pipeline` once before replying so the user sees the freshest active step.",
    "- If the user asks to keep watching progress, continue looping with `forge_wait_pipeline` and report each step transition.",
    "- Never call the local `task` tool for orchestration.",
    "",
    "When calling `forge_submit_request`, include:",
    "- `source`: `opencode`",
    "- `type`: one of `feature`, `bug`, `refactor`, `release`",
    "- `title`: short user-facing title",
    "- `description`: concise execution request",
    "- `briefMarkdown`: approved brief",
    "- `requestedBy`: `user`",
    "",
    "For direct specialist mode:",
    "- `forge_run_agent_direct`",
    "- choose the specialist requested by the user",
    "- immediately call `forge_get_pipeline` after creation and report which specialist is active",
  ].join("\n");

  return matter.stringify(`${body}\n`, buildClientProjectionFrontmatter(agent, defaultClientProjectionConfig(agent.slug)));
}

function renderSpecialistProjection(agent: OpenCodeAgentDefinition, config: ClientProjectionConfig): string {
  const body = [
    `You are the ${agent.name} client projection for Forge.`,
    "You do not implement locally.",
    "",
    "Rules:",
    `- Translate the user's request into a backend run by calling \`forge_run_agent_direct\` with requestedAgentSlug \`${agent.slug}\`.`,
    "- Use source `opencode` and requestedBy `user`.",
    "- Never use local task chaining or local code execution for orchestration.",
    "- After the backend run is created, immediately call `forge_get_pipeline` and tell the user which agent/step is active.",
    "- If the run is still active, call `forge_wait_pipeline` once before replying so the user gets a fresher status update.",
    "- If the request is not appropriate for this specialist, tell the user and suggest switching to Receptionist.",
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
    "- Use `forge_submit_request` for approved feature, bug, refactor, and release requests.",
    "- Use `forge_run_agent_direct` for direct specialist requests.",
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
    const content = agent.slug === "receptionist"
      ? renderReceptionistProjection(agent)
      : renderSpecialistProjection(agent, agent.clientConfig);
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
    default_agent: opencodeAgents.some((agent) => agent.slug === "receptionist")
      ? "receptionist"
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
