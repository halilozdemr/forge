import { execSync } from "child_process";
import { resolve, join } from "path";
import { createChildLogger } from "../utils/logger.js";

const log = createChildLogger("migrate");

export async function runMigrations(): Promise<void> {
  const schemaPath = resolve(join(import.meta.dirname, "..", "..", "prisma", "schema.prisma"));
  log.info("Running database migrations...");
  try {
    execSync(`npx prisma migrate deploy --schema="${schemaPath}"`, {
      stdio: "pipe",
      env: process.env,
    });
    log.info("Migrations complete");
  } catch (err) {
    log.warn("Migration deploy failed, trying db push...");
    try {
      execSync(`npx prisma db push --schema="${schemaPath}" --accept-data-loss`, {
        stdio: "pipe",
        env: process.env,
      });
      log.info("DB push complete");
    } catch (pushErr) {
      log.error({ err: pushErr }, "Database setup failed");
      throw pushErr;
    }
  }
}
