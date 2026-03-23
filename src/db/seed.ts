import { PrismaClient } from "@prisma/client";
import { createChildLogger } from "../utils/logger.js";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const log = createChildLogger("seed");

// Tier definitions: heavy agents need strong reasoning, light agents do routine work
const HEAVY_AGENTS = ["architect", "reviewer", "debugger"]; // need best model
const LIGHT_AGENTS = ["receptionist", "pm", "builder", "devops", "designer", "scrum_master"];

export interface ProviderStrategy {
  heavy: { provider: string; model: string };  // architect, reviewer, debugger
  light: { provider: string; model: string };  // pm, builder, devops, designer, scrum_master
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
    slug: "receptionist",
    name: "Receptionist",
    role: "Client liaison, request intake, flow routing",
    reportsTo: null,
    permissions: { task: true, read: true, edit: false, write: false, bash: false },
    heartbeatCron: null,
  },
  {
    slug: "pm",
    name: "Product Manager",
    role: "Sprint planning, task decomposition",
    reportsTo: "receptionist",
    permissions: { task: true, read: true, edit: true, write: true, bash: false },
    heartbeatCron: null,
  },
  {
    slug: "architect",
    name: "Lead Architect",
    role: "Technical decisions, architecture design, escalation",
    reportsTo: "pm",
    permissions: { task: true, bash: true, read: true, edit: false, write: false },
    heartbeatCron: null,
  },
  {
    slug: "builder",
    name: "Builder",
    role: "Code implementation",
    reportsTo: "architect",
    permissions: { task: true, read: true, edit: true, write: true, bash: true },
    heartbeatCron: null,
  },
  {
    slug: "reviewer",
    name: "Code Reviewer",
    role: "Code review, quality gate",
    reportsTo: "builder",
    permissions: { task: true, bash: true, read: true, edit: false, write: false },
    heartbeatCron: null,
  },
  {
    slug: "debugger",
    name: "Debugger",
    role: "Bug investigation and hotfix",
    reportsTo: "receptionist",
    permissions: { task: true, read: true, edit: true, write: true, bash: true },
    heartbeatCron: null,
  },
  {
    slug: "devops",
    name: "DevOps Engineer",
    role: "Git workflow, deployment",
    reportsTo: "receptionist",
    permissions: { bash: true, read: true, edit: false, write: false, task: false },
    heartbeatCron: null,
  },
  {
    slug: "designer",
    name: "UI/UX Designer",
    role: "UI specifications, UX flows",
    reportsTo: "architect",
    permissions: { task: true, read: true, edit: false, write: false, bash: false },
    heartbeatCron: null,
  },
  {
    slug: "scrum_master",
    name: "Scrum Master",
    role: "Retrospectives, process improvement",
    reportsTo: "receptionist",
    permissions: { task: true, read: true, edit: true, write: true, bash: false },
    heartbeatCron: "0 */6 * * *",
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
    for (const agentDef of options.customAgents) {
      const promptPath = join(__dirname, "..", "agents", "defaults", `${agentDef.slug}.md`);
      const promptFile = existsSync(promptPath) ? promptPath : null;

      await db.agent.upsert({
        where: { companyId_slug: { companyId: company.id, slug: agentDef.slug } },
        update: options.forceUpdate
          ? {
              promptFile,
              modelProvider: agentDef.modelProvider,
              model: agentDef.model,
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

      const promptPath = join(__dirname, "..", "agents", "defaults", `${agentDef.slug}.md`);
      const promptFile = existsSync(promptPath) ? promptPath : null;

      await db.agent.upsert({
        where: {
          companyId_slug: { companyId: company.id, slug: agentDef.slug },
        },
        update: options.forceUpdate
          ? {
              promptFile,
              modelProvider: provider,
              model,
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
