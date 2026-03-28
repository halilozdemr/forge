import fs from "fs";
import path from "path";
import os from "os";
import matter from "gray-matter";
import { PrismaClient } from "@prisma/client";
import { fileURLToPath } from "url";
import { buildDefaultClientConfigForSlug, ALL_BUILTIN_AGENT_SLUGS } from "../src/agents/constants.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const prisma = new PrismaClient();

const HEAVY_OFFICIAL = new Set(["architect", "quality-guard"]);

async function main() {
  const configPath = path.join(os.homedir(), ".forge", "config.json");
  if (!fs.existsSync(configPath)) {
    console.error(`Error: config file not found at ${configPath}`);
    console.error("Please run 'forge init' first.");
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

  const company = await prisma.company.findFirst();
  if (!company) {
    console.error("Error: No company found in DB. Please run 'forge init' first or seed the database.");
    process.exit(1);
  }

  const officialAgentsDir = path.join(__dirname, "..", "ai-system", "official", "agents");
  if (!fs.existsSync(officialAgentsDir)) {
    console.error(`Error: official agents directory not found at ${officialAgentsDir}`);
    process.exit(1);
  }

  console.log(`Seeding ${ALL_BUILTIN_AGENT_SLUGS.length} built-in agents from ${officialAgentsDir}`);

  for (const slug of ALL_BUILTIN_AGENT_SLUGS) {
    const promptFile = path.join(officialAgentsDir, `${slug}.md`);
    if (!fs.existsSync(promptFile)) {
      console.warn(`Skipping ${slug}: prompt file not found at ${promptFile}`);
      continue;
    }

    const content = fs.readFileSync(promptFile, "utf-8");
    const parsed = matter(content);
    const { data } = parsed;

    const fallbackProvider = HEAVY_OFFICIAL.has(slug)
      ? config?.agentStrategy?.heavy?.provider ?? config?.defaultProvider ?? "claude-cli"
      : config?.agentStrategy?.light?.provider ?? config?.defaultProvider ?? "openrouter";
    const fallbackModel = HEAVY_OFFICIAL.has(slug)
      ? config?.agentStrategy?.heavy?.model ?? config?.defaultModel ?? "sonnet"
      : config?.agentStrategy?.light?.model ?? config?.defaultModel ?? "deepseek/deepseek-v3-0324:free";

    const modelProvider = config?.agents?.[slug]?.modelProvider || fallbackProvider;
    const model = config?.agents?.[slug]?.model || fallbackModel;

    const permissions = data.permissions || data.permission || {};
    const permissionsStr = typeof permissions === "object" ? JSON.stringify(permissions) : "{}";

    await prisma.agent.upsert({
      where: { companyId_slug: { companyId: company.id, slug } },
      update: {
        name: String(data.name || slug),
        role: String(data.description || data.role || slug),
        modelProvider,
        model,
        promptFile,
        permissions: permissionsStr,
        clientConfig: JSON.stringify(buildDefaultClientConfigForSlug(slug)),
      },
      create: {
        companyId: company.id,
        slug,
        name: String(data.name || slug),
        role: String(data.description || data.role || slug),
        modelProvider,
        model,
        reportsTo: null,
        status: "idle",
        permissions: permissionsStr,
        promptFile,
        clientConfig: JSON.stringify(buildDefaultClientConfigForSlug(slug)),
      },
    });

    console.log(`Seeded ${slug} -> provider: ${modelProvider}, model: ${model}`);
  }

  console.log("Built-in agent seeding complete.");
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
