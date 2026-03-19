import { Command } from "commander";
import { readPidFile, isProcessRunning } from "../../utils/process.js";
import { loadConfig } from "../../utils/config.js";

export function statusCommand(): Command {
  return new Command("status")
    .description("Show Forge system status")
    .action(runStatus);
}

async function runStatus(): Promise<void> {
  const pid = readPidFile();
  const isRunning = pid ? isProcessRunning(pid) : false;
  const config = loadConfig();

  console.log("\nForge v3 Status\n" + "─".repeat(40));
  console.log(`Server:    ${isRunning ? `\x1b[32mrunning\x1b[0m (PID ${pid})` : "\x1b[31mstopped\x1b[0m"}`);
  console.log(`Port:      ${config.port}`);
  console.log(`Claude:    ${config.claudePath}`);
  console.log(`Project:   ${config.projectPath}`);

  if (!isRunning) {
    console.log("\nRun \x1b[1mnpx forge start\x1b[0m to launch.\n");
    return;
  }

  // Ping health endpoint
  try {
    const res = await fetch(`http://localhost:${config.port}/health`);
    const health = (await res.json()) as Record<string, unknown>;
    console.log(`DB:        ${health.db === "connected" ? "\x1b[32mconnected\x1b[0m" : "\x1b[31m" + health.db + "\x1b[0m"}`);
    console.log(`Uptime:    ${Math.round(Number(health.uptime))}s`);
  } catch {
    console.log(`Health:    \x1b[33munavailable\x1b[0m`);
  }

  console.log();
}
