import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface ForgeConfig {
  port: number;
  host: string;
  concurrency: number;
  databaseUrl: string;
  claudePath: string;
  projectPath: string;
  logLevel: string;
  workspace: {
    policy: "shared" | "per_task" | "git_worktree";
    autoPr?: boolean;
  };
}

const DEFAULT_DB_PATH = join(homedir(), ".forge", "forge.db");

const DEFAULT_CONFIG: ForgeConfig = {
  port: 3131,
  host: "0.0.0.0",
  concurrency: 3,
  databaseUrl: `file:${DEFAULT_DB_PATH}`,
  claudePath: "",
  projectPath: process.cwd(),
  logLevel: "info",
  workspace: {
    policy: "shared",
    autoPr: false,
  },
};

function findClaudeCli(): string {
  const candidates = [
    join(homedir(), ".local", "bin", "claude"),
    "/usr/local/bin/claude",
    "/opt/homebrew/bin/claude",
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return "claude";
}

export function loadConfig(overrides: Partial<ForgeConfig> = {}): ForgeConfig {
  let fileConfig: Partial<ForgeConfig> = {};
  const rcPath = join(process.cwd(), ".forge", "config.json");

  if (existsSync(rcPath)) {
    try {
      fileConfig = JSON.parse(readFileSync(rcPath, "utf-8"));
    } catch {
      // ignore malformed config
    }
  }

  // Env overrides
  const envConfig: Partial<ForgeConfig> = {};
  if (process.env.FORGE_PORT) envConfig.port = parseInt(process.env.FORGE_PORT, 10);
  if (process.env.FORGE_HOST) envConfig.host = process.env.FORGE_HOST;
  if (process.env.FORGE_CONCURRENCY) envConfig.concurrency = parseInt(process.env.FORGE_CONCURRENCY, 10);
  if (process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith("file:")) envConfig.databaseUrl = process.env.DATABASE_URL;
  if (process.env.CLAUDE_CLI_PATH) envConfig.claudePath = process.env.CLAUDE_CLI_PATH;
  if (process.env.LOG_LEVEL) envConfig.logLevel = process.env.LOG_LEVEL;

  const config = {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    ...envConfig,
    ...overrides,
  };

  if (!config.claudePath) {
    config.claudePath = findClaudeCli();
  }

  return config;
}
