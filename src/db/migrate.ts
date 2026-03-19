import { execSync } from "child_process";
import { resolve, join } from "path";
import { createChildLogger } from "../utils/logger.js";

const log = createChildLogger("migrate");

export async function runMigrations(): Promise<void> {
  // dist/src/db → dist/src → dist → project root → prisma/
  const schemaPath = resolve(join(import.meta.dirname, "..", "..", "..", "prisma", "schema.prisma"));
  log.info({ schemaPath }, "Running database migrations...");
  try {
    execSync(`npx prisma db push --schema="${schemaPath}" --accept-data-loss`, {
      stdio: "pipe",
      env: process.env,
    });
    log.info("DB push complete — schema synced");
  } catch (err) {
    log.error({ err }, "Database setup failed");
    throw err;
  }
}
