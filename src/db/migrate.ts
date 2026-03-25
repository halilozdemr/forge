import { execSync } from "child_process";
import { resolve, join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import { createChildLogger } from "../utils/logger.js";

const log = createChildLogger("migrate");

function findProjectRoot(): string {
  // Try relative to this source file first: src/db/migrate.ts → project root
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);

  // When running via tsx: __dirname = src/db → go up 2 levels = project root
  const fromSource = resolve(__dirname, "..", "..");
  if (existsSync(join(fromSource, "prisma", "schema.prisma"))) {
    return fromSource;
  }

  // When running from dist: dist/src/db → go up 3 levels = project root
  const fromDist = resolve(__dirname, "..", "..", "..");
  if (existsSync(join(fromDist, "prisma", "schema.prisma"))) {
    return fromDist;
  }

  // Fallback to cwd
  return process.cwd();
}

export async function runMigrations(): Promise<void> {
  const projectRoot = findProjectRoot();
  const schemaPath = join(projectRoot, "prisma", "schema.prisma");
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
