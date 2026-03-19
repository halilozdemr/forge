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

export function sprintCommand(): Command {
  const cmd = new Command("sprint").description("Manage sprints");

  cmd
    .command("list")
    .description("List sprints")
    .option("--project <id>", "Project ID")
    .action(async (opts) => {
      const params = opts.project ? `?projectId=${opts.project}` : "";
      const { sprints } = await api<{ sprints: any[] }>(`/v1/sprints${params}`);
      if (!sprints.length) {
        console.log("No sprints found.");
        return;
      }
      console.log("\nSprints\n" + "─".repeat(60));
      for (const s of sprints) {
        console.log(`  #${String(s.number).padEnd(4)} [${s.status.padEnd(12)}] ${s.goal} (${s._count?.issues ?? 0} issues)`);
      }
      console.log();
    });

  cmd
    .command("show <id>")
    .description("Show sprint details and issues")
    .action(async (id) => {
      const { sprint } = await api<{ sprint: any }>(`/v1/sprints/${id}`);
      console.log(`\nSprint #${sprint.number}: ${sprint.goal}`);
      console.log(`Status: ${sprint.status}\n`);
      if (sprint.issues?.length) {
        console.log("Issues:");
        for (const i of sprint.issues) {
          const agent = i.assignedAgent ? `(${i.assignedAgent.slug})` : "";
          console.log(`  [${i.status.padEnd(12)}] ${i.title} ${agent}`);
        }
      }
      console.log();
    });

  cmd
    .command("active")
    .description("Show the active sprint")
    .option("--project <id>", "Project ID")
    .action(async (opts) => {
      const params = opts.project ? `?projectId=${opts.project}` : "";
      const { sprints } = await api<{ sprints: any[] }>(`/v1/sprints${params}`);
      const active = sprints.find((s) => s.status === "active");
      if (!active) {
        console.log("No active sprint.");
        return;
      }
      console.log(`Active: Sprint #${active.number} — ${active.goal}`);
    });

  return cmd;
}
