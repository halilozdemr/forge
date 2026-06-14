import { PrismaClient } from "@prisma/client";
import { loadConfig } from "../utils/config.js";

let prisma: PrismaClient | null = null;

/**
 * Ensure DATABASE_URL is populated before the Prisma client is constructed.
 * `forge start` sets it explicitly, but standalone CLI/MCP commands reach the
 * DB without going through start, so derive it from the resolved config here
 * (a no-op when it is already set, e.g. via the environment or .env).
 */
function ensureDatabaseUrl(): void {
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = loadConfig().databaseUrl;
  }
}

export function getDb(): PrismaClient {
  if (!prisma) {
    ensureDatabaseUrl();
    prisma = new PrismaClient({
      log: process.env.LOG_LEVEL === "debug" ? ["query", "info", "warn", "error"] : ["warn", "error"],
    });
  }
  return prisma;
}

export async function disconnectDb(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
  }
}
