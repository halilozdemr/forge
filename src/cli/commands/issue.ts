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

const STATUS_COLORS: Record<string, string> = {
  open: "\x1b[32m",
  in_progress: "\x1b[33m",
  done: "\x1b[34m",
  failed: "\x1b[31m",
  escalated: "\x1b[35m",
};

export function issueCommand(): Command {
  const cmd = new Command("issue").description("Manage issues");

  cmd
    .command("list")
    .description("List issues")
    .option("--project <id>", "Project ID")
    .option("--status <status>", "Filter by status")
    .option("--company <id>", "Company ID")
    .action(async (opts) => {
      const companyId = await resolveCompany(opts.company);
      const params = new URLSearchParams();
      if (opts.project) params.set("projectId", opts.project);
      if (opts.status) params.set("status", opts.status);
      params.set("companyId", companyId);

      const { issues } = await api<{ issues: any[] }>(`/v1/issues?${params}`);
      if (!issues.length) {
        console.log("No issues found.");
        return;
      }
      console.log("\nIssues\n" + "─".repeat(70));
      for (const i of issues) {
        const color = STATUS_COLORS[i.status] ?? "";
        const reset = "\x1b[0m";
        const agent = i.assignedAgent ? `→ ${i.assignedAgent.slug}` : "";
        console.log(`  [${color}${i.status}${reset}] ${i.type.padEnd(10)} ${i.title.slice(0, 40).padEnd(42)} ${agent}`);
      }
      console.log();
    });

  cmd
    .command("create")
    .description("Create a new issue")
    .requiredOption("--project <id>", "Project ID")
    .requiredOption("--title <title>", "Issue title")
    .option("--type <type>", "Issue type (feature|bug|refactor|release|chore)", "feature")
    .option("--priority <p>", "Priority (low|normal|high|critical)", "normal")
    .option("--description <desc>", "Issue description")
    .action(async (opts) => {
      const { issue } = await api<{ issue: any }>("/v1/issues", "POST", {
        projectId: opts.project,
        title: opts.title,
        type: opts.type,
        priority: opts.priority,
        description: opts.description,
      });
      console.log(`Issue created: ${issue.id} — "${issue.title}" [${issue.type}]`);
    });

  cmd
    .command("show <id>")
    .description("Show issue details")
    .action(async (id) => {
      const { issue } = await api<{ issue: any }>(`/v1/issues/${id}`);
      console.log("\n" + "─".repeat(60));
      console.log(`ID:       ${issue.id}`);
      console.log(`Title:    ${issue.title}`);
      console.log(`Type:     ${issue.type}`);
      console.log(`Status:   ${issue.status}`);
      console.log(`Priority: ${issue.priority}`);
      if (issue.assignedAgent) console.log(`Agent:    ${issue.assignedAgent.slug}`);
      if (issue.sprint) console.log(`Sprint:   #${issue.sprint.number} — ${issue.sprint.goal}`);
      if (issue.result) console.log(`\nResult:\n${issue.result.slice(0, 500)}`);
      console.log();
    });

  cmd
    .command("run <id>")
    .description("Execute an issue immediately")
    .option("--company <id>", "Company ID")
    .option("--agent <slug>", "Agent override")
    .action(async (id, opts) => {
      const companyId = await resolveCompany(opts.company);
      const { jobId } = await api<{ jobId: string }>(`/v1/issues/${id}/run`, "POST", {
        companyId,
        agentSlug: opts.agent,
      });
      console.log(`Issue ${id} enqueued for execution. Job ID: ${jobId}`);
      console.log(`Check status with: \x1b[1mnpx forge queue status --job ${jobId}\x1b[0m`);
    });

  return cmd;
}
