import fs from "fs";
import path from "path";
import os from "os";
import matter from "gray-matter";
import { PrismaClient } from "@prisma/client";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const prisma = new PrismaClient();

async function main() {
  const configPath = path.join(os.homedir(), ".forge", "config.json");
  if (!fs.existsSync(configPath)) {
    console.error(`Error: config file not found at ${configPath}`);
    console.error("Please run 'forge init' first to dynamically configure agent models/providers.");
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  
  const company = await prisma.company.findFirst();
  if (!company) {
    console.error("Error: No company found in DB. Please run 'forge init' first or seed the database.");
    process.exit(1);
  }

  const opencodeAgentsDir = path.join(os.homedir(), ".config", "opencode", "agents");
  if (!fs.existsSync(opencodeAgentsDir)) {
    console.error(`Error: OpenCode agents directory not found at ${opencodeAgentsDir}`);
    process.exit(1);
  }

  const files = fs.readdirSync(opencodeAgentsDir).filter((f) => f.endsWith(".md") && f !== "receptionist.md");
  
  console.log(`Found ${files.length} OpenCode agents. Migrating to Forge DB...`);

  const defaultsDir = path.join(__dirname, "..", "src", "agents", "defaults");
  if (!fs.existsSync(defaultsDir)) fs.mkdirSync(defaultsDir, { recursive: true });

  for (const file of files) {
    const slug = file.replace(".md", "");
    const content = fs.readFileSync(path.join(opencodeAgentsDir, file), "utf-8");
    const parsed = matter(content);

    // Save prompt to defaults dir, stripping frontmatter
    const promptFile = path.join(defaultsDir, `${slug}.md`);
    fs.writeFileSync(promptFile, parsed.content.trim());

    const { data } = parsed;

    // Dynamically resolve provider and model from config
    let modelProvider = "openrouter";
    let model = "deepseek/deepseek-v3.2";
    
    if (config.agents && config.agents[slug]) {
        modelProvider = config.agents[slug].modelProvider || config.defaultProvider || modelProvider;
        model = config.agents[slug].model || config.defaultModel || model;
    } else {
        modelProvider = config.defaultProvider || modelProvider;
        model = config.defaultModel || model;
    }

    const permissions = data.permissions || data.permission || {};
    const permissionsStr = typeof permissions === 'object' ? JSON.stringify(permissions) : "{}";

    await prisma.agent.upsert({
      where: { companyId_slug: { companyId: company.id, slug } },
      update: {
        name: data.name || slug,
        role: data.role || data.name || slug,
        promptFile,
        permissions: permissionsStr,
      },
      create: {
        companyId: company.id,
        slug,
        name: data.name || slug,
        role: data.role || data.name || slug,
        modelProvider,
        model,
        reportsTo: null,
        status: "idle",
        permissions: permissionsStr,
        promptFile,
      },
    });

    console.log(`Migrated ${slug} -> provider: ${modelProvider}, model: ${model}`);
  }

  // İkinci geçiş: reportsTo id ile guncelleme
  const pm = await prisma.agent.findFirst({ where: { companyId: company.id, slug: "pm" } });
  const architect = await prisma.agent.findFirst({ where: { companyId: company.id, slug: "architect" } });
  const builder = await prisma.agent.findFirst({ where: { companyId: company.id, slug: "builder" } });
  const designer = await prisma.agent.findFirst({ where: { companyId: company.id, slug: "designer" } });
  const reviewer = await prisma.agent.findFirst({ where: { companyId: company.id, slug: "reviewer" } });

  if (architect && pm) await prisma.agent.update({ where: { id: architect.id }, data: { reportsTo: pm.id } });
  if (builder && architect) await prisma.agent.update({ where: { id: builder.id }, data: { reportsTo: architect.id } });
  if (designer && architect) await prisma.agent.update({ where: { id: designer.id }, data: { reportsTo: architect.id } });
  if (reviewer && builder) await prisma.agent.update({ where: { id: reviewer.id }, data: { reportsTo: builder.id } });

  console.log("Migration complete.");
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
