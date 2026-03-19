import { Command } from "commander";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { createChildLogger } from "../../utils/logger.js";
import { loadConfig } from "../../utils/config.js";
import { writePidFile, setupGracefulShutdown } from "../../utils/process.js";
import { runMigrations } from "../../db/migrate.js";
import { getDb, disconnectDb } from "../../db/client.js";
import { seedDatabase } from "../../db/seed.js";
import { createServer } from "../../server/index.js";
import { createAgentWorker, closeWorker } from "../../bridge/worker.js";
import { getQueue, closeQueue } from "../../bridge/queue.js";
import { startHeartbeatScheduler, stopHeartbeatScheduler } from "../../heartbeat/scheduler.js";
import Redis from "ioredis";

const log = createChildLogger("start");

export function startCommand(): Command {
  return new Command("start")
    .description("Start Forge server, worker and heartbeat scheduler")
    .option("--port <port>", "HTTP server port", "3131")
    .option("--concurrency <n>", "Worker concurrency", "3")
    .option("--pg-url <url>", "PostgreSQL connection URL")
    .option("--redis-url <url>", "Redis connection URL")
    .action(runStart);
}

async function runStart(opts: {
  port: string;
  concurrency: string;
  pgUrl?: string;
  redisUrl?: string;
}): Promise<void> {
  const config = loadConfig({
    port: parseInt(opts.port, 10),
    concurrency: parseInt(opts.concurrency, 10),
    ...(opts.pgUrl && { databaseUrl: opts.pgUrl }),
    ...(opts.redisUrl && { redisUrl: opts.redisUrl }),
  });

  if (!config.databaseUrl) {
    log.error("DATABASE_URL is required. Set it in environment or pass --pg-url.");
    process.exit(1);
  }

  process.env.DATABASE_URL = config.databaseUrl;

  log.info("Starting Forge v3...");

  // 1. Run DB migrations
  await runMigrations();

  // 2. Seed default company/agents if .forge/config.json exists
  const forgeConfigPath = join(process.cwd(), ".forge", "config.json");
  if (existsSync(forgeConfigPath)) {
    try {
      const forgeConfig = JSON.parse(readFileSync(forgeConfigPath, "utf-8"));
      const db = getDb();
      await seedDatabase(db, {
        companyName: forgeConfig.company?.name ?? "My Forge",
        companySlug: forgeConfig.company?.slug ?? "my-forge",
        projectName: forgeConfig.project?.name ?? "default",
        projectPath: forgeConfig.project?.path ?? process.cwd(),
        stack: forgeConfig.project?.stack ?? "other",
      });
    } catch (err) {
      log.warn({ err }, "Failed to seed from .forge/config.json — continuing");
    }
  }

  // 3. Redis connection
  const redis = new Redis(config.redisUrl, {
    maxRetriesPerRequest: null,
    lazyConnect: true,
  });

  await redis.connect();
  log.info("Redis connected");

  const connection = { host: redis.options.host, port: redis.options.port as number };

  // 4. BullMQ queue + worker
  getQueue(connection);
  const worker = createAgentWorker(connection, config.concurrency);
  log.info(`Worker started (concurrency: ${config.concurrency})`);

  // 5. Heartbeat scheduler
  await startHeartbeatScheduler(connection);
  log.info("Heartbeat scheduler started");

  // 6. HTTP server
  const server = await createServer(config.port, config.host);

  // 7. PID file
  writePidFile();

  log.info(`Forge running on http://localhost:${config.port}`);
  log.info(`Claude CLI: ${config.claudePath}`);

  // 8. Graceful shutdown
  setupGracefulShutdown(async () => {
    log.info("Shutting down...");
    await server.close();
    await stopHeartbeatScheduler();
    await closeWorker();
    await closeQueue();
    await redis.quit();
    await disconnectDb();
  });
}
