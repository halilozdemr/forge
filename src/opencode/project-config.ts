import { existsSync } from "fs";
import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import matter from "gray-matter";
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
