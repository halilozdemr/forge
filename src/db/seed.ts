import { PrismaClient } from "@prisma/client";
import { createChildLogger } from "../utils/logger.js";
import { existsSync } from "fs";
import {
  buildDefaultClientConfigForSlug,
  HARNESS_AGENT_SLUGS,
  isOfficialAgentSlug,
  OFFICIAL_AGENT_PROMPT_DIR,
  USER_AGENT_PROMPT_DIR,
} from "../agents/constants.js";

const log = createChildLogger("seed");
// Tier definitions: architect/quality checks are heavy, other official stages are light.
const HEAVY_AGENTS = ["architect", "quality-guard"];

export interface ProviderStrategy {
  heavy: { provider: string; model: string };
  light: { provider: string; model: string };
}

// Sensible defaults by available providers
export const PROVIDER_PRESETS: Record<string, ProviderStrategy> = {
  "claude-cli-only": {
    heavy: { provider: "claude-cli", model: "sonnet" },
    light: { provider: "claude-cli", model: "sonnet" },
  },
  "claude-cli+openrouter": {
    heavy: { provider: "claude-cli",  model: "sonnet" },
    light: { provider: "openrouter",  model: "deepseek/deepseek-v3-0324:free" },
  },
  "claude-cli+gemini-cli": {
    heavy: { provider: "claude-cli",  model: "sonnet" },
    light: { provider: "gemini-cli",  model: "gemini-2.0-flash" },
  },
  "anthropic-api-only": {
    heavy: { provider: "anthropic-api", model: "claude-sonnet-4-6" },
    light: { provider: "anthropic-api", model: "claude-haiku-4-5-20251001" },
  },
  "anthropic-api+openrouter": {
    heavy: { provider: "anthropic-api", model: "claude-sonnet-4-6" },
    light: { provider: "openrouter",    model: "deepseek/deepseek-v3-0324:free" },
  },
  "openrouter-only": {
    heavy: { provider: "openrouter", model: "anthropic/claude-sonnet-4-6" },
    light: { provider: "openrouter", model: "deepseek/deepseek-v3-0324:free" },
  },
  "openai-only": {
    heavy: { provider: "openai", model: "gpt-4o" },
    light: { provider: "openai", model: "gpt-4o-mini" },
  },
  "openai+openrouter": {
    heavy: { provider: "openai",     model: "gpt-4o" },
    light: { provider: "openrouter", model: "deepseek/deepseek-v3-0324:free" },
  },
  "gemini-cli-only": {
    heavy: { provider: "gemini-cli", model: "gemini-2.5-pro" },
    light: { provider: "gemini-cli", model: "gemini-2.0-flash" },
  },
  "codex-cli-only": {
    heavy: { provider: "codex-cli", model: "codex-mini-latest" },
    light: { provider: "codex-cli", model: "codex-mini-latest" },
  },
  "gemini-api-only": {
    heavy: { provider: "gemini-api", model: "gemini-2.5-pro" },
    light: { provider: "gemini-api", model: "gemini-2.0-flash" },
  },
  "ollama-only": {
    heavy: { provider: "ollama", model: "llama3.2" },
    light: { provider: "ollama", model: "llama3.2" },
  },
  "claude-cli+ollama": {
    heavy: { provider: "claude-cli", model: "sonnet" },
    light: { provider: "ollama",     model: "llama3.2" },
  },
  "gemini-api+openrouter": {
    heavy: { provider: "gemini-api", model: "gemini-2.5-pro" },
    light: { provider: "openrouter", model: "deepseek/deepseek-v3-0324:free" },
  },
};

export interface CustomAgentDef {
  slug: string;
  name: string;
  role: string;
  modelProvider: string;
  model: string;
  reportsTo: string | null;
  permissions: Record<string, boolean>;
  heartbeatCron: string | null;
}

interface AgentDefinition {
  slug: string;
  name: string;
  role: string;
  reportsTo: string | null;
  permissions: Record<string, boolean>;
  heartbeatCron: string | null;
}

const AGENT_DEFINITIONS: AgentDefinition[] = [
  {
    slug: "intake-gate",
    name: "Intake Gate",
    role: "Stage-1 intake normalization and execution_brief generation",
    reportsTo: null,
    permissions: { task: true, read: true, edit: false, write: false, bash: false },
    heartbeatCron: null,
  },
  {
    slug: "architect",
    name: "Architect",
    role: "Stage-2 architecture_plan generation",
    reportsTo: null,
    permissions: { task: true, bash: true, read: true, edit: false, write: false },
    heartbeatCron: null,
  },
  {
    slug: "builder",
    name: "Builder",
    role: "Stage-3 implementation into work_result",
    reportsTo: null,
    permissions: { task: true, read: true, edit: true, write: true, bash: true },
    heartbeatCron: null,
  },
  {
    slug: "quality-guard",
    name: "Quality Guard",
    role: "Stage-4 validation of work_result against execution_brief and architecture_plan",
    reportsTo: null,
    permissions: { task: true, bash: true, read: true, edit: false, write: false },
    heartbeatCron: null,
  },
  {
    slug: "devops",
    name: "DevOps",
    role: "Optional operational readiness and release artifacts",
    reportsTo: null,
    permissions: { task: true, bash: true, read: true, edit: false, write: false },
    heartbeatCron: null,
  },
  {
    slug: "retrospective-analyst",
    name: "Retrospective Analyst",
    role: "Optional learning_report and process insight artifact",
    reportsTo: null,
    permissions: { task: true, read: true, edit: false, write: false, bash: false },
    heartbeatCron: "0 */6 * * *",
  },
  {
    slug: "planner",
    name: "Planner",
    role: "Harness-only planner that expands a request into a ProductSpec artifact",
    reportsTo: null,
    permissions: { task: true, read: true, edit: false, write: false, bash: false },
    heartbeatCron: null,
  },
  {
    slug: "evaluator",
    name: "Evaluator",
    role: "Harness-only evaluator that reviews SprintContracts and verifies BuildResults",
    reportsTo: null,
    permissions: { task: true, bash: true, read: true, edit: false, write: false },
    heartbeatCron: null,
  },
  {
    slug: "harness-builder",
    name: "Harness Builder",
    role: "Harness-only builder that proposes SprintContracts and implements approved sprint scope",
    reportsTo: null,
    permissions: { task: true, read: true, edit: true, write: true, bash: true },
    heartbeatCron: null,
  },
];

interface SeedOptions {
  companyName: string;
  companySlug: string;
  projectName: string;
  projectPath: string;
  stack: string;
  providerStrategy?: ProviderStrategy;
  customAgents?: CustomAgentDef[];
  forceUpdate?: boolean;
}

function findAgentDefinition(slug: string): AgentDefinition {
  const definition = AGENT_DEFINITIONS.find((agent) => agent.slug === slug);
  if (!definition) {
    throw new Error(`Missing built-in agent definition for "${slug}"`);
  }
  return definition;
}

function resolveModelTierForAgent(slug: string, strategy: ProviderStrategy): { provider: string; model: string } {
  const isHeavy = HEAVY_AGENTS.includes(slug);
  return isHeavy ? strategy.heavy : strategy.light;
}

function resolveAgentPromptFile(slug: string): string | null {
  const baseDir = isOfficialAgentSlug(slug) ? OFFICIAL_AGENT_PROMPT_DIR : USER_AGENT_PROMPT_DIR;
  const promptPath = `${baseDir}/${slug}.md`;
  return existsSync(promptPath) ? promptPath : null;
}

export async function seedDatabase(db: PrismaClient, options: SeedOptions): Promise<{
  companyId: string;
  projectId: string;
  agentCount: number;
}> {
  log.info(`Seeding database for company "${options.companyName}"...`);

  // Create company
  const company = await db.company.upsert({
    where: { slug: options.companySlug },
    update: { name: options.companyName },
    create: {
      name: options.companyName,
      slug: options.companySlug,
    },
  });

  // Create project
  const project = await db.project.upsert({
    where: {
      companyId_name: { companyId: company.id, name: options.projectName },
    },
    update: { path: options.projectPath, stack: options.stack },
    create: {
      companyId: company.id,
      name: options.projectName,
      path: options.projectPath,
      stack: options.stack,
    },
  });

  let agentCount = 0;

  if (options.customAgents !== undefined) {
    // Custom agents path: each agent has its own provider/model
    const strategy = options.providerStrategy ?? PROVIDER_PRESETS["claude-cli-only"];
    const customAgentSlugs = new Set(options.customAgents.map((agent) => agent.slug));

    for (const agentDef of options.customAgents) {
      const promptFile = resolveAgentPromptFile(agentDef.slug);
      const namespace = isOfficialAgentSlug(agentDef.slug) ? "official" : "user";

      await db.agent.upsert({
        where: { companyId_slug: { companyId: company.id, slug: agentDef.slug } },
        update: options.forceUpdate
          ? {
              promptFile,
              modelProvider: agentDef.modelProvider,
              model: agentDef.model,
              clientConfig: JSON.stringify(buildDefaultClientConfigForSlug(agentDef.slug, namespace)),
            }
          : { promptFile },
        create: {
          companyId: company.id,
          slug: agentDef.slug,
          name: agentDef.name,
          role: agentDef.role,
          modelProvider: agentDef.modelProvider,
          model: agentDef.model,
          reportsTo: agentDef.reportsTo,
          status: "idle",
          permissions: JSON.stringify(agentDef.permissions),
          clientConfig: JSON.stringify(buildDefaultClientConfigForSlug(agentDef.slug, namespace)),
          heartbeatCron: agentDef.heartbeatCron,
          promptFile,
        },
      });
      agentCount++;
    }

    // Ensure structured-runtime internal agents always exist even for legacy/custom configurations.
    for (const slug of HARNESS_AGENT_SLUGS) {
      if (customAgentSlugs.has(slug)) continue;

      const agentDef = findAgentDefinition(slug);
      const promptFile = resolveAgentPromptFile(slug);
      const { provider, model } = resolveModelTierForAgent(slug, strategy);

      await db.agent.upsert({
        where: { companyId_slug: { companyId: company.id, slug } },
        update: options.forceUpdate
          ? {
              promptFile,
              modelProvider: provider,
              model,
              clientConfig: JSON.stringify(buildDefaultClientConfigForSlug(slug, "official")),
            }
          : { promptFile },
        create: {
          companyId: company.id,
          slug,
          name: agentDef.name,
          role: agentDef.role,
          modelProvider: provider,
          model,
          reportsTo: agentDef.reportsTo,
          status: "idle",
          permissions: JSON.stringify(agentDef.permissions),
          clientConfig: JSON.stringify(buildDefaultClientConfigForSlug(slug, "official")),
          heartbeatCron: agentDef.heartbeatCron,
          promptFile,
        },
      });
      agentCount++;
    }
  } else {
    // Default agents path: apply heavy/light tier strategy
    const strategy = options.providerStrategy ?? PROVIDER_PRESETS["claude-cli-only"];
    for (const agentDef of AGENT_DEFINITIONS) {
      const isHeavy = HEAVY_AGENTS.includes(agentDef.slug);
      const { provider, model } = isHeavy ? strategy.heavy : strategy.light;
      const promptFile = resolveAgentPromptFile(agentDef.slug);

      await db.agent.upsert({
        where: {
          companyId_slug: { companyId: company.id, slug: agentDef.slug },
        },
        update: options.forceUpdate
          ? {
              promptFile,
              modelProvider: provider,
              model,
              clientConfig: JSON.stringify(buildDefaultClientConfigForSlug(agentDef.slug, "official")),
            }
          : {
              // On re-seed: only update promptFile (don't overwrite manual model changes)
              promptFile,
            },
        create: {
          companyId: company.id,
          slug: agentDef.slug,
          name: agentDef.name,
          role: agentDef.role,
          modelProvider: provider,
          model: model,
          reportsTo: agentDef.reportsTo,
          status: "idle",
          permissions: JSON.stringify(agentDef.permissions),
          clientConfig: JSON.stringify(buildDefaultClientConfigForSlug(agentDef.slug, "official")),
          heartbeatCron: agentDef.heartbeatCron,
          promptFile,
        },
      });
      agentCount++;
    }
  }

  log.info(`Seeded: company=${company.id}, project=${project.id}, agents=${agentCount}${options.customAgents !== undefined ? " (custom)" : ` (heavy: ${options.providerStrategy?.heavy.provider ?? "claude-cli"}/${options.providerStrategy?.heavy.model ?? "sonnet"}, light: ${options.providerStrategy?.light.provider ?? "claude-cli"}/${options.providerStrategy?.light.model ?? "sonnet"})`}`);

  return { companyId: company.id, projectId: project.id, agentCount };
}
