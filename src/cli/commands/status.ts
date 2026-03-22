import { Command } from "commander";
import { readPidFile, isProcessRunning } from "../../utils/process.js";
import { loadConfig } from "../../utils/config.js";
import { resolveCompany } from "../../utils/company.js";
import { existsSync, statSync } from "fs";

export function statusCommand(): Command {
  return new Command("status")
    .description("Show Forge system status")
    .action(runStatus);
}

async function runStatus(): Promise<void> {
  const pid = readPidFile();
  const isRunning = pid ? isProcessRunning(pid) : false;
  const config = loadConfig();

  let dbSize = "0 MB";
  if (config.databaseUrl?.startsWith("file:")) {
    const dbPath = config.databaseUrl.replace("file:", "");
    if (existsSync(dbPath)) {
      const stats = statSync(dbPath);
      dbSize = (stats.size / (1024 * 1024)).toFixed(1) + " MB";
    }
  }

  console.log(`\nForge v3 — ${isRunning ? "\x1b[32mRunning\x1b[0m" : "\x1b[31mStopped\x1b[0m"}`);
  console.log("───────────────────────────────");

  if (!isRunning) {
    console.log(`Port:       ${config.port}`);
    console.log(`DB:         ${config.databaseUrl?.replace("file:", "") ?? "unknown"} (${dbSize})`);
    console.log("\nRun \x1b[1mnpx forge start\x1b[0m to launch.\n");
    return;
  }

  try {
    const companyId = await resolveCompany().catch(() => undefined);
    const params = companyId ? `?companyId=${companyId}` : "";
    const res = await fetch(`http://localhost:${config.port}/v1/status${params}`);
    if (!res.ok) throw new Error("Status failed");
    
    const data = await res.json() as any;

    if (data.company) {
      console.log(`Company:    ${data.company.name} (slug: ${data.company.slug})`);
    } else {
      console.log(`Company:    not configured`);
    }

    if (data.project) {
      console.log(`Project:    ${data.project.name}`);
    } else {
      console.log(`Project:    not configured`);
    }

    const dbPathStr = config.databaseUrl?.replace("file:", "") ?? "unknown";
    console.log(`DB:         ${dbPathStr} (${dbSize})`);
    console.log(`Cloud:      not configured\n`);

    console.log("Queue");
    console.log(`  Pending:    ${data.queue?.pending ?? 0}`);
    console.log(`  Running:    ${data.queue?.running ?? 0}`);
    console.log(`  Failed:     ${data.queue?.failed ?? 0}\n`);

    console.log(`Agents (${data.agents?.total ?? 0})`);
    console.log(`  idle:       ${data.agents?.idle ?? 0}`);
    console.log(`  running:    ${data.agents?.running ?? 0}`);
    console.log(`  paused:     ${data.agents?.paused ?? 0}\n`);

    console.log("Heartbeat");
    const scheduleCount = data.heartbeat?.scheduledCount ?? 0;
    const scheduledAgents = (data.heartbeat?.scheduledAgents ?? []).join(", ");
    console.log(`  Scheduled:  ${scheduleCount} agent${scheduleCount === 1 ? "" : "s"} ${scheduleCount > 0 ? `(${scheduledAgents})` : ""}`);

    if (data.heartbeat?.nextRunMs) {
      const ms = data.heartbeat.nextRunMs;
      const hours = Math.floor(ms / (1000 * 60 * 60));
      const mins = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
      console.log(`  Next run:   in ${hours}h ${mins}m`);
    } else {
      console.log(`  Next run:   none`);
    }

  } catch (err) {
    console.log(`Port:       ${config.port}`);
    console.log(`DB:         ${config.databaseUrl} (${dbSize})`);
    console.log(`API Health: \x1b[33munavailable\x1b[0m`);
  }

  console.log();
}
