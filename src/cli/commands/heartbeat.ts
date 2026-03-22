import { Command } from "commander";
import { loadConfig } from "../../utils/config.js";
import { resolveCompany } from "../../utils/company.js";

function baseUrl(): string {
  return `http://localhost:${loadConfig().port}`;
}

async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = (await res.json()) as { error: string };
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function heartbeatCommand(): Command {
  const cmd = new Command("heartbeat").description("Manage agent heartbeats");

  cmd
    .command("list")
    .description("List all agent heartbeat schedules")
    .option("--company <id>", "Company ID")
    .action(async (opts) => {
      const companyId = await resolveCompany(opts.company);
      const { agents } = await api<{ agents: any[] }>(`/v1/agents?companyId=${companyId}`);
      const scheduled = agents.filter((a) => a.heartbeatCron);

      console.log("\nHeartbeat Schedules\n" + "─".repeat(60));
      if (!scheduled.length) {
        console.log("  No agents have heartbeat schedules.");
      } else {
        for (const a of scheduled) {
          console.log(`  ${a.slug.padEnd(20)} ${a.heartbeatCron}  [${a.status}]`);
        }
      }
      console.log();
    });

  cmd
    .command("enable <slug>")
    .description("Enable heartbeat for an agent")
    .option("--company <id>", "Company ID")
    .requiredOption("--cron <expr>", 'Cron expression (e.g. "0 */6 * * *")')
    .action(async (slug, opts) => {
      const companyId = await resolveCompany(opts.company);
      await api(`/v1/agents/${slug}`, "PUT", {
        companyId,
        heartbeatCron: opts.cron,
      });
      console.log(`Heartbeat enabled for ${slug}: ${opts.cron}`);
    });

  cmd
    .command("disable <slug>")
    .description("Disable heartbeat for an agent")
    .option("--company <id>", "Company ID")
    .action(async (slug, opts) => {
      const companyId = await resolveCompany(opts.company);
      await api(`/v1/agents/${slug}`, "PUT", {
        companyId,
        heartbeatCron: null,
      });
      console.log(`Heartbeat disabled for ${slug}.`);
    });

  cmd
    .command("run <slug>")
    .description("Manually trigger a heartbeat for an agent with live log")
    .option("--company <id>", "Company ID")
    .action(async (slug, opts) => {
      const companyId = await resolveCompany(opts.company);
      
      console.log(`\n\x1b[1m💓 Running heartbeat for @${slug}...\x1b[0m\n`);

      const { getDb } = await import("../../db/client.js");
      const db = getDb();

      // We run the handler logic locally
      const { runHeartbeatForAgent } = await import("../../heartbeat/handlers.js");
      const runId = await runHeartbeatForAgent({ agentSlug: slug, companyId });

      const run = await db.heartbeatRun.findUnique({ where: { id: runId } });
      
      if (run?.status === "completed") {
        console.log(`\x1b[32m✔ Completed:\x1b[0m ${run.result}`);
      } else {
        console.log(`\x1b[31m✖ Failed:\x1b[0m ${run?.result || "Unknown error"}`);
      }
      console.log();
    });

  cmd
    .command("runs")
    .description("Show recent heartbeat run history")
    .option("--company <id>", "Company ID")
    .option("--agent <slug>", "Filter by agent slug")
    .action(async (opts) => {
      const companyId = await resolveCompany(opts.company);
      const params = new URLSearchParams({ companyId });
      if (opts.agent) params.set("agentSlug", opts.agent);
      const { runs } = await api<{ runs: any[] }>(`/v1/heartbeat/runs?${params}`);

      console.log("\nHeartbeat Runs\n" + "─".repeat(70));
      if (!runs.length) {
        console.log("  No heartbeat runs found.");
      } else {
        for (const r of runs) {
          const ts = new Date(r.triggeredAt).toLocaleString();
          const status = r.status === "completed" ? "\x1b[32mcompleted\x1b[0m"
            : r.status === "failed" ? "\x1b[31mfailed\x1b[0m"
            : r.status;
          console.log(`  ${r.agentSlug.padEnd(20)} ${status.padEnd(22)} ${ts}`);
        }
      }
      console.log();
    });

  return cmd;
}
