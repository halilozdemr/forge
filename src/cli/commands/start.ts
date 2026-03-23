import { Command } from "commander";
import { existsSync, readFileSync } from "fs";
import { mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { createChildLogger } from "../../utils/logger.js";
import { loadConfig } from "../../utils/config.js";
import { writePidFile, setupGracefulShutdown } from "../../utils/process.js";
import { runMigrations } from "../../db/migrate.js";
import { getDb, disconnectDb } from "../../db/client.js";
import { seedDatabase, ProviderStrategy, CustomAgentDef } from "../../db/seed.js";
import { createServer } from "../../server/index.js";
import { createAgentWorker, closeWorker } from "../../bridge/worker.js";
import { getQueue, closeQueue } from "../../bridge/queue.js";
import { startHeartbeatScheduler, stopHeartbeatScheduler } from "../../heartbeat/scheduler.js";
import { startSyncWorker, stopSyncWorker } from "../../sync/worker.js";

const log = createChildLogger("start");

export function startCommand(): Command {
  return new Command("start")
    .description("Start Forge server, worker and heartbeat scheduler")
    .option("--port <port>", "HTTP server port", "3131")
    .option("--concurrency <n>", "Worker concurrency", "3")
    .action(runStart);
}

async function runStart(opts: {
  port: string;
  concurrency: string;
}): Promise<void> {
  const config = loadConfig({
    port: parseInt(opts.port, 10),
    concurrency: parseInt(opts.concurrency, 10),
  });

  process.env.DATABASE_URL = config.databaseUrl;

  log.info("Starting Forge v3...");

  // ~/.forge dizini oluştur
  await mkdir(join(homedir(), ".forge"), { recursive: true });

  // 1. Run DB migrations
  await runMigrations();

  // 2. Seed default company/agents
  const forgeConfigPath = join(process.cwd(), ".forge", "config.json");
  let seedOptions: {
    companyName: string;
    companySlug: string;
    projectName: string;
    projectPath: string;
    stack: string;
    providerStrategy?: ProviderStrategy;
    customAgents?: CustomAgentDef[];
    forceUpdate?: boolean;
  } = {
    companyName: "My Forge",
    companySlug: "my-forge",
    projectName: "default",
    projectPath: process.cwd(),
    stack: "other",
  };

  if (existsSync(forgeConfigPath)) {
    try {
      const forgeConfig = JSON.parse(readFileSync(forgeConfigPath, "utf-8"));
      seedOptions = {
        companyName: forgeConfig.company?.name ?? seedOptions.companyName,
        companySlug: forgeConfig.company?.slug ?? seedOptions.companySlug,
        projectName: forgeConfig.project?.name ?? seedOptions.projectName,
        projectPath: forgeConfig.project?.path ?? seedOptions.projectPath,
        stack: forgeConfig.project?.stack ?? seedOptions.stack,
        providerStrategy: forgeConfig.agentStrategy,
        customAgents: forgeConfig.agents,
        forceUpdate: true,
      };
      // Load API keys from config into env if not already set
      if (forgeConfig.providers?.openrouter?.apiKey && !process.env.OPENROUTER_API_KEY) {
        process.env.OPENROUTER_API_KEY = forgeConfig.providers.openrouter.apiKey;
      }
      if (forgeConfig.providers?.anthropicApi?.apiKey && !process.env.ANTHROPIC_API_KEY) {
        process.env.ANTHROPIC_API_KEY = forgeConfig.providers.anthropicApi.apiKey;
      }
    } catch (err) {
      log.warn({ err }, "Failed to read .forge/config.json — using defaults");
    }
  } else {
    log.info("No .forge/config.json found — seeding with defaults. Run `forge init` for customization.");
  }

  try {
    const db = getDb();
    await seedDatabase(db, seedOptions);
  } catch (err) {
    log.warn({ err }, "Failed to seed database — continuing");
  }

  // 4. Queue + worker
  getQueue();
  const worker = createAgentWorker(config.concurrency);
  log.info(`Worker started (concurrency: ${config.concurrency})`);

  // 5. Heartbeat scheduler
  await startHeartbeatScheduler();

  // 6. Sync worker
  await startSyncWorker();

  // 7. HTTP server
  const server = await createServer(config.port, config.host);

  // 8. PID file
  writePidFile();

  log.info(`Forge running on http://localhost:${config.port}`);
  log.info(`Claude CLI: ${config.claudePath}`);

  // 9. Graceful shutdown
  setupGracefulShutdown(async () => {
    log.info("Shutting down...");
    await server.close();
    await stopHeartbeatScheduler();
    await stopSyncWorker();
    await closeWorker();
    await closeQueue();
    await disconnectDb();
  });
}
