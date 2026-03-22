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

export function labelCommand(): Command {
  const cmd = new Command("label").description("Manage company labels");

  cmd
    .command("create <name>")
    .description("Create or update a label")
    .option("--color <color>", "Label color (hex)", "#6b7280")
    .option("--company <id>", "Company ID")
    .action(async (name, opts) => {
      const companyId = await resolveCompany(opts.company);
      const { label } = await api<{ label: any }>("/v1/labels", "POST", {
        companyId,
        name,
        color: opts.color,
      });
      console.log(`Label "${label.name}" (${label.color}) created/updated successfully.`);
    });

  cmd
    .command("list")
    .description("List all labels for the company")
    .option("--company <id>", "Company ID")
    .action(async (opts) => {
      const companyId = await resolveCompany(opts.company);
      const { labels } = await api<{ labels: any[] }>(`/v1/labels?companyId=${companyId}`);

      if (!labels.length) {
        console.log("No labels found.");
        return;
      }

      console.log("\nCompany Labels\n" + "─".repeat(40));
      for (const l of labels) {
        // Simple ANSI color approximation or just show hex
        console.log(`  • ${l.name.padEnd(20)} ${l.color}`);
      }
      console.log();
    });

  cmd
    .command("delete <name>")
    .description("Delete a label by name")
    .option("--company <id>", "Company ID")
    .action(async (name, opts) => {
      const companyId = await resolveCompany(opts.company);
      
      // 1. Find the label by name first to get the ID
      const { labels } = await api<{ labels: any[] }>(`/v1/labels?companyId=${companyId}`);
      const label = labels.find((l) => l.name === name);

      if (!label) {
        console.error(`Error: Label "${name}" not found.`);
        process.exit(1);
      }

      const { message } = await api<{ message: string }>(`/v1/labels/${label.id}`, "DELETE");
      console.log(message);
    });

  return cmd;
}
