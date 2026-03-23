import { readFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";

export interface FirmConfig {
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

const DEFAULT_CONFIG: FirmConfig = {
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

export function loadConfig(overrides: Partial<FirmConfig> = {}): FirmConfig {
  // Load from .firmrc if exists
  let fileConfig: Partial<FirmConfig> = {};
  const rcPathFirm = join(process.cwd(), ".firm", "config.json");
  const rcPathForge = join(process.cwd(), ".forge", "config.json");
  const rcPath = existsSync(rcPathForge) ? rcPathForge : rcPathFirm;
  
  if (existsSync(rcPath)) {
    try {
      fileConfig = JSON.parse(readFileSync(rcPath, "utf-8"));
    } catch {
      // ignore malformed config
    }
  }

  // Env overrides
  const envConfig: Partial<FirmConfig> = {};
  if (process.env.FIRM_PORT) envConfig.port = parseInt(process.env.FIRM_PORT, 10);
  if (process.env.FIRM_HOST) envConfig.host = process.env.FIRM_HOST;
  if (process.env.FIRM_CONCURRENCY) envConfig.concurrency = parseInt(process.env.FIRM_CONCURRENCY, 10);
  if (process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith("file:")) envConfig.databaseUrl = process.env.DATABASE_URL;
  if (process.env.CLAUDE_PATH) envConfig.claudePath = process.env.CLAUDE_PATH;
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
