import { execSync } from "child_process";
import { resolve, join } from "path";
import { createChildLogger } from "../utils/logger.js";

const log = createChildLogger("migrate");

export async function runMigrations(): Promise<void> {
  // dist/src/db → dist/src → dist → project root
  const projectRoot = resolve(join(import.meta.dirname, "..", "..", ".."));
  const schemaPath = join(projectRoot, "prisma", "schema.prisma");
  // Use local prisma binary (v5) instead of globally installed npx prisma (may be v7+)
  const prismaBin = join(projectRoot, "node_modules", ".bin", "prisma");

  log.info({ schemaPath }, "Running database migrations...");
  try {
    execSync(`"${prismaBin}" db push --schema="${schemaPath}" --accept-data-loss`, {
      stdio: "pipe",
      env: process.env,
    });
    log.info("DB push complete — schema synced");
  } catch (err) {
    log.error({ err }, "Database setup failed");
    throw err;
  }
}
