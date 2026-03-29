import { Command } from "commander";
import { existsSync, readFileSync } from "fs";
import { mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { createChildLogger, setGlobalLogLevel } from "../../utils/logger.js";
import { loadConfig } from "../../utils/config.js";
import { writePidFile, setupGracefulShutdown } from "../../utils/process.js";
import { runMigrations } from "../../db/migrate.js";
import { getDb, disconnectDb } from "../../db/client.js";
import { seedDatabase, ProviderStrategy, CustomAgentDef } from "../../db/seed.js";
import { createServer } from "../../server/index.js";
import { createAgentWorker, closeWorker } from "../../bridge/worker.js";
import { getQueue, closeQueue } from "../../bridge/queue.js";
import { startHeartbeatScheduler, stopHeartbeatScheduler } from "../../heartbeat/scheduler.js";
import { syncProjectOpenCodeConfig, syncProjectClientProjectionsFromRegistry } from "../../opencode/project-config.js";
import { startForgeConsoleShell } from "../console/shell.js";

const log = createChildLogger("start");

export function startCommand(): Command {
  return new Command("start")
    .description("Start Forge runtime (console-first by default)")
    .option("--port <port>", "HTTP server port", "3131")
    .option("--concurrency <n>", "Worker concurrency", "3")
    .option("--headless", "Run in raw server/log mode (no interactive console shell)")
    .action(runStart);
}

async function runStart(opts: {
  port: string;
  concurrency: string;
  headless?: boolean;
}): Promise<void> {
  const nonInteractiveTerminal = !process.stdin.isTTY || !process.stdout.isTTY;
  const headlessMode = Boolean(opts.headless) || nonInteractiveTerminal;

  // Console-first mode should avoid info/debug log spam by default.
  // Respect explicit LOG_LEVEL overrides for users who intentionally requested verbosity.
  if (!headlessMode && !process.env.LOG_LEVEL) {
    setGlobalLogLevel("warn");
  }

  const config = loadConfig({
    port: parseInt(opts.port, 10),
    concurrency: parseInt(opts.concurrency, 10),
  });

  process.env.DATABASE_URL = config.databaseUrl;

  if (headlessMode) {
    log.info("Starting Forge v3...");
    if (nonInteractiveTerminal && !opts.headless) {
      log.info("TTY not detected; falling back to headless mode. Use --headless for explicit debug/server runs.");
    }
  } else {
    process.stdout.write(`\nForge Console booting on http://localhost:${config.port}\n`);
    process.stdout.write("Starting runtime services...\n");
  }

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
      const configuredAgents = Array.isArray(forgeConfig.agents) ? forgeConfig.agents : undefined;
      seedOptions = {
        companyName: forgeConfig.company?.name ?? seedOptions.companyName,
        companySlug: forgeConfig.company?.slug ?? seedOptions.companySlug,
        projectName: forgeConfig.project?.name ?? seedOptions.projectName,
        projectPath: forgeConfig.project?.path ?? seedOptions.projectPath,
        stack: forgeConfig.project?.stack ?? seedOptions.stack,
        providerStrategy: forgeConfig.agentStrategy,
        customAgents: configuredAgents && configuredAgents.length > 0 ? configuredAgents : undefined,
        forceUpdate: true,
      };
      // Load API keys from config into env if not already set
      if (forgeConfig.providers?.openrouter?.apiKey && !process.env.OPENROUTER_API_KEY) {
        process.env.OPENROUTER_API_KEY = forgeConfig.providers.openrouter.apiKey;
      }
      if (forgeConfig.providers?.anthropicApi?.apiKey && !process.env.ANTHROPIC_API_KEY) {
        process.env.ANTHROPIC_API_KEY = forgeConfig.providers.anthropicApi.apiKey;
      }

      await syncProjectOpenCodeConfig(forgeConfig);
    } catch (err) {
      log.warn({ err }, "Failed to read .forge/config.json — using defaults");
    }
  } else {
    log.info("No .forge/config.json found — seeding with defaults. Run `forge init` for customization.");
  }

  let seededCompanyId: string | null = null;
  try {
    const db = getDb();
    const seeded = await seedDatabase(db, seedOptions);
    seededCompanyId = seeded.companyId;
    await syncProjectClientProjectionsFromRegistry({
      db,
      companyId: seeded.companyId,
      projectPath: seedOptions.projectPath,
    });
  } catch (err) {
    log.warn({ err }, "Failed to seed database — continuing");
  }

  // 4. Queue + worker
  getQueue();
  const worker = createAgentWorker(config.concurrency);
  log.info(`Worker started (concurrency: ${config.concurrency})`);

  // 5. Heartbeat scheduler
  await startHeartbeatScheduler();

  // 6. HTTP server
  const server = await createServer(config.port, config.host);

  // 7. PID file
  writePidFile();

  let stopConsoleShell: (() => void) | null = null;

  // 8. Graceful shutdown
  setupGracefulShutdown(async () => {
    stopConsoleShell?.();
    log.info("Shutting down...");
    await server.close();
    await stopHeartbeatScheduler();
    await closeWorker();
    await closeQueue();
    await disconnectDb();
  });

  if (headlessMode) {
    log.info(`Forge running on http://localhost:${config.port}`);
    log.info(`Claude CLI: ${config.claudePath}`);
    log.info("Headless mode active. Use `forge start` for the interactive console.");
    return;
  }

  stopConsoleShell = await startForgeConsoleShell({
    port: config.port,
    initialCompanyId: seededCompanyId,
    onRequestShutdown: () => {
      try {
        process.kill(process.pid, "SIGINT");
      } catch {
        process.exit(0);
      }
    },
  });
}
