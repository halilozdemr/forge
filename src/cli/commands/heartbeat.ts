import { Command } from "commander";
import { loadConfig } from "../../utils/config.js";

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
    .requiredOption("--company <id>", "Company ID")
    .action(async (opts) => {
      const { agents } = await api<{ agents: any[] }>(`/v1/agents?companyId=${opts.company}`);
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
    .requiredOption("--company <id>", "Company ID")
    .requiredOption("--cron <expr>", 'Cron expression (e.g. "0 */6 * * *")')
    .action(async (slug, opts) => {
      await api(`/v1/agents/${slug}`, "PUT", {
        companyId: opts.company,
        heartbeatCron: opts.cron,
      });
      console.log(`Heartbeat enabled for ${slug}: ${opts.cron}`);
    });

  cmd
    .command("disable <slug>")
    .description("Disable heartbeat for an agent")
    .requiredOption("--company <id>", "Company ID")
    .action(async (slug, opts) => {
      await api(`/v1/agents/${slug}`, "PUT", {
        companyId: opts.company,
        heartbeatCron: null,
      });
      console.log(`Heartbeat disabled for ${slug}.`);
    });

  cmd
    .command("run <slug>")
    .description("Manually trigger a heartbeat for an agent")
    .requiredOption("--company <id>", "Company ID")
    .action(async (slug, opts) => {
      const { run } = await api<{ run: any }>("/v1/heartbeat/trigger", "POST", {
        agentSlug: slug,
        companyId: opts.company,
      });
      console.log(`Heartbeat triggered for ${slug} (run id: ${run.id})`);
    });

  cmd
    .command("runs")
    .description("Show recent heartbeat run history")
    .requiredOption("--company <id>", "Company ID")
    .option("--agent <slug>", "Filter by agent slug")
    .action(async (opts) => {
      const params = new URLSearchParams({ companyId: opts.company });
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
