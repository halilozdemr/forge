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
  if (existsSync(rcPath)) {
    try {
      const fileConfig = JSON.parse(readFileSync(rcPath, "utf-8")) as ForgeConfig;
      const slug = fileConfig.company?.slug;
      if (slug) {
        const company = await db.company.findUnique({
          where: { slug },
        });
        if (company) return company.id;
      }
    } catch {
      // Fall through to default single-company resolution below.
    }
  }

  const fallbackCompany = await db.company.findFirst({
    orderBy: { createdAt: "asc" },
  });
  if (fallbackCompany) return fallbackCompany.id;

  throw new Error("No company found. Start Forge with `forge start` to seed a default company.");
}
