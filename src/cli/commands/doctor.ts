import { Command } from "commander";
import { execSync } from "child_process";
import { existsSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { p } from "../prompts.js";

export function doctorCommand(): Command {
  return new Command("doctor")
    .description("Check Forge setup and diagnose issues")
    .option("--fix", "Attempt to auto-repair issues where possible")
    .action(runDoctor);
}

interface CheckResult {
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
  hint?: string;
}

async function runDoctor(_opts: { fix?: boolean }): Promise<void> {
  p.log.step("Forge Doctor — running diagnostics...\n");

  const results: CheckResult[] = [];

  // ── 1. Local CLIs ─────────────────────────────────────────────────────────────
  results.push(checkCli("claude", "Claude Code CLI",
    [process.env.CLAUDE_CLI_PATH, `${homedir()}/.local/bin/claude`, "/usr/local/bin/claude", "/opt/homebrew/bin/claude"],
    "Install from https://claude.ai/code"));
  results.push(checkCli("gemini", "Gemini CLI",
    [process.env.GEMINI_CLI_PATH, `${homedir()}/.local/bin/gemini`, "/usr/local/bin/gemini"],
    "Install from https://github.com/google-gemini/gemini-cli", true));
  results.push(checkCli("codex", "Codex CLI",
    [process.env.CODEX_CLI_PATH, "/usr/local/bin/codex"],
    "Install from https://github.com/openai/codex", true));

  // ── 2. .forge/config.json ─────────────────────────────────────────────────────
  results.push(checkForgeConfig());

  // ── 3. Database file ──────────────────────────────────────────────────────────
  results.push(checkDatabase());

  // ── 4. Providers (API keys) ───────────────────────────────────────────────────
  results.push(...checkApiKeys());

  // ── 5. Forge server reachability ──────────────────────────────────────────────
  results.push(await checkServer());

  // ── 6. Node.js version ────────────────────────────────────────────────────────
  results.push(checkNodeVersion());

  // ── Print results ─────────────────────────────────────────────────────────────
  let passed = 0;
  let warned = 0;
  let failed = 0;

  for (const r of results) {
    const icon = r.status === "pass" ? "✓" : r.status === "warn" ? "!" : "✗";
    const color =
      r.status === "pass" ? "\x1b[32m" : r.status === "warn" ? "\x1b[33m" : "\x1b[31m";
    const reset = "\x1b[0m";

    console.log(`  ${color}${icon}${reset}  ${r.name}`);
    if (r.status !== "pass") {
      console.log(`     ${r.message}`);
      if (r.hint) console.log(`     \x1b[2mHint: ${r.hint}\x1b[0m`);
    }

    if (r.status === "pass") passed++;
    else if (r.status === "warn") warned++;
    else failed++;
  }

  console.log("");

  if (failed === 0 && warned === 0) {
    p.log.success(`All ${passed} checks passed — Forge is ready.`);
  } else if (failed === 0) {
    p.log.warn(`${passed} passed, ${warned} warning(s). Forge should work but review warnings above.`);
  } else {
    p.log.error(`${failed} check(s) failed. Fix the issues above before running \x1b[1mforge start\x1b[0m.`);
    process.exit(1);
  }
}

// ─── Check functions ──────────────────────────────────────────────────────────

function checkCli(
  bin: string,
  name: string,
  extraCandidates: (string | undefined)[],
  installHint: string,
  optional = false
): CheckResult {
  const candidates = [...extraCandidates.filter(Boolean) as string[], bin];
  for (const candidate of candidates) {
    try {
      const version = execSync(`"${candidate}" --version 2>&1`, { timeout: 5000 })
        .toString().trim().split("\n")[0];
      return { name, status: "pass", message: `${version} at ${candidate}` };
    } catch { continue; }
  }
  return {
    name,
    status: optional ? "warn" : "warn",
    message: "Not installed",
    hint: installHint,
  };
}

function checkForgeConfig(): CheckResult {
  const configPath = join(process.cwd(), ".forge", "config.json");
  if (!existsSync(configPath)) {
    return {
      name: ".forge/config.json",
      status: "warn",
      message: "Not found — default settings will be used",
      hint: "Run `forge init` to customize your setup",
    };
  }
  try {
    const cfg = JSON.parse(readFileSync(configPath, "utf-8"));
    return {
      name: ".forge/config.json",
      status: "pass",
      message: `Company: ${cfg.company?.name ?? "unknown"}, Project: ${cfg.project?.name ?? "unknown"}`,
    };
  } catch {
    return {
      name: ".forge/config.json",
      status: "fail",
      message: "File exists but could not be parsed",
      hint: "Check for JSON syntax errors in .forge/config.json",
    };
  }
}

function checkDatabase(): CheckResult {
  const dbPath = join(homedir(), ".forge", "forge.db");
  if (existsSync(dbPath)) {
    const size = statSync(dbPath).size;
    return {
      name: "SQLite database",
      status: "pass",
      message: `${dbPath} (${(size / 1024).toFixed(0)} KB)`,
    };
  }
  return {
    name: "SQLite database",
    status: "warn",
    message: "Not found — will be created on first `forge start`",
    hint: `Expected at: ${dbPath}`,
  };
}

function checkApiKeys(): CheckResult[] {
  const apiKeys: Array<{ name: string; envVar: string; configKey: string }> = [
    { name: "OpenRouter API key",  envVar: "OPENROUTER_API_KEY", configKey: "openrouter"   },
    { name: "Anthropic API key",   envVar: "ANTHROPIC_API_KEY",  configKey: "anthropicApi" },
    { name: "OpenAI API key",      envVar: "OPENAI_API_KEY",     configKey: "openai"       },
  ];

  return apiKeys.map(({ name, envVar, configKey }) => {
    const key = process.env[envVar] ?? readKeyFromConfig(configKey);
    if (key) {
      return { name, status: "pass" as const, message: `Found (${key.slice(0, 8)}...)` };
    }
    return {
      name,
      status: "warn" as const,
      message: `${envVar} not set`,
      hint: "Only needed if agents use this provider",
    };
  });
}

async function checkServer(): Promise<CheckResult> {
  try {
    const res = await fetch("http://localhost:3131/health", { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const data = await res.json() as { status: string; version: string };
      return {
        name: "Forge server",
        status: data.status === "healthy" ? "pass" : "warn",
        message: `Running — status: ${data.status}, version: ${data.version}`,
      };
    }
    return { name: "Forge server", status: "warn", message: `Responded with HTTP ${res.status}` };
  } catch {
    return {
      name: "Forge server",
      status: "warn",
      message: "Not running",
      hint: "Run `forge start` to launch",
    };
  }
}

function checkNodeVersion(): CheckResult {
  const version = process.version; // e.g. "v20.11.0"
  const major = parseInt(version.slice(1).split(".")[0], 10);
  if (major >= 18) {
    return { name: "Node.js", status: "pass", message: version };
  }
  return {
    name: "Node.js",
    status: "fail",
    message: `${version} — Node.js 18+ required`,
    hint: "Upgrade Node.js from https://nodejs.org",
  };
}

function readKeyFromConfig(provider: string): string | undefined {
  try {
    const configPath = join(process.cwd(), ".forge", "config.json");
    if (!existsSync(configPath)) return undefined;
    const cfg = JSON.parse(readFileSync(configPath, "utf-8"));
    return cfg.providers?.[provider]?.apiKey;
  } catch {
    return undefined;
  }
}
