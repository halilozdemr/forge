import { PrismaClient } from "@prisma/client";
import { createChildLogger } from "../utils/logger.js";

const log = createChildLogger("seed");

interface SeedOptions {
  companyName: string;
  companySlug: string;
  projectName: string;
  projectPath: string;
  stack: string;
}

const DEFAULT_AGENTS = [
  {
    slug: "receptionist",
    name: "Receptionist",
    role: "Client liaison, request intake, flow routing",
    modelProvider: "openrouter",
    model: "moonshotai/kimi-k2.5",
    reportsTo: null,
    permissions: { task: true, read: true, edit: false, write: false, bash: false },
    heartbeatCron: null,
  },
  {
    slug: "pm",
    name: "Product Manager",
    role: "Sprint planning, task decomposition",
    modelProvider: "openrouter",
    model: "deepseek/deepseek-v3.2",
    reportsTo: "receptionist",
    permissions: { task: true, read: true, edit: true, write: true, bash: false },
    heartbeatCron: null,
  },
  {
    slug: "architect",
    name: "Lead Architect",
    role: "Technical decisions, architecture design, escalation",
    modelProvider: "claude-cli",
    model: "sonnet",
    reportsTo: "pm",
    permissions: { task: true, bash: true, read: true, edit: false, write: false },
    heartbeatCron: null,
  },
  {
    slug: "builder",
    name: "Builder",
    role: "Code implementation",
    modelProvider: "openrouter",
    model: "moonshotai/kimi-k2.5",
    reportsTo: "architect",
    permissions: { task: true, read: true, edit: true, write: true, bash: true },
    heartbeatCron: null,
  },
  {
    slug: "reviewer",
    name: "Code Reviewer",
    role: "Code review, quality gate",
    modelProvider: "claude-cli",
    model: "sonnet",
    reportsTo: "builder",
    permissions: { task: true, bash: true, read: true, edit: false, write: false },
    heartbeatCron: null,
  },
  {
    slug: "debugger",
    name: "Debugger",
    role: "Bug investigation and hotfix",
    modelProvider: "claude-cli",
    model: "sonnet",
    reportsTo: "receptionist",
    permissions: { task: true, read: true, edit: true, write: true, bash: true },
    heartbeatCron: null,
  },
  {
    slug: "devops",
    name: "DevOps Engineer",
    role: "Git workflow, deployment",
    modelProvider: "openrouter",
    model: "moonshotai/kimi-k2.5",
    reportsTo: "receptionist",
    permissions: { bash: true, read: true, edit: false, write: false, task: false },
    heartbeatCron: null,
  },
  {
    slug: "designer",
    name: "UI/UX Designer",
    role: "UI specifications, UX flows",
    modelProvider: "openrouter",
    model: "moonshotai/kimi-k2.5",
    reportsTo: "architect",
    permissions: { task: true, read: true, edit: false, write: false, bash: false },
    heartbeatCron: null,
  },
  {
    slug: "scrum_master",
    name: "Scrum Master",
    role: "Retrospectives, process improvement",
    modelProvider: "openrouter",
    model: "moonshotai/kimi-k2.5",
    reportsTo: "receptionist",
    permissions: { task: true, read: true, edit: true, write: true, bash: false },
    heartbeatCron: "0 */6 * * *",
  },
];

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

  // Create default agents
  let agentCount = 0;
  for (const agentDef of DEFAULT_AGENTS) {
    await db.agent.upsert({
      where: {
        companyId_slug: { companyId: company.id, slug: agentDef.slug },
      },
      update: {},
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
      },
    });
    agentCount++;
  }

  log.info(`Seeded: company=${company.id}, project=${project.id}, agents=${agentCount}`);

  return { companyId: company.id, projectId: project.id, agentCount };
}
