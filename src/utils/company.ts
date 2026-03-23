import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { getDb } from "../db/client.js";

interface ForgeConfig {
  company?: {
    slug?: string;
  };
}

export async function resolveCompany(flagValue?: string): Promise<string> {
  const db = getDb();
  
  if (flagValue) {
    const company = await db.company.findFirst({
      where: {
        OR: [{ id: flagValue }, { slug: flagValue }],
      },
    });
    if (company) return company.id;
    throw new Error(`Company '${flagValue}' not found.`);
  }

  const rcPath = join(process.cwd(), ".forge", "config.json");
  if (!existsSync(rcPath)) {
    throw new Error("No company found. Run `forge init` first, or provide --company.");
  }

  let fileConfig: ForgeConfig;
  try {
    fileConfig = JSON.parse(readFileSync(rcPath, "utf-8"));
  } catch (err) {
    throw new Error("Malformed .forge/config.json. Run `forge init` again.");
  }

  const slug = fileConfig.company?.slug;
  if (!slug) {
    throw new Error("No company slug found in .forge/config.json. Run `forge init` again.");
  }

  const company = await db.company.findUnique({
    where: { slug },
  });

  if (!company) {
    throw new Error(`Company with slug '${slug}' not found in database. Is 'forge start' running?`);
  }

  return company.id;
}
