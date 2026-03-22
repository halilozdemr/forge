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

export function secretCommand(): Command {
  const cmd = new Command("secret").description("Manage company secrets (API keys, etc.)");

  cmd
    .command("set <name> <value>")
    .description("Set or update a secret")
    .option("--company <id>", "Company ID")
    .option("--description <desc>", "Optional description")
    .action(async (name, value, opts) => {
      const companyId = await resolveCompany(opts.company);
      await api("/v1/secrets", "POST", {
        companyId,
        name,
        value,
        description: opts.description,
      });
      console.log(`Secret "${name}" set successfully.`);
    });

  cmd
    .command("list")
    .description("List all secrets for the company")
    .option("--company <id>", "Company ID")
    .action(async (opts) => {
      const companyId = await resolveCompany(opts.company);
      const { secrets } = await api<{ secrets: any[] }>(`/v1/secrets?companyId=${companyId}`);
      
      if (!secrets.length) {
        console.log("No secrets found.");
        return;
      }

      console.log("\nCompany Secrets\n" + "─".repeat(60));
      console.log(`  ${"NAME".padEnd(24)} ${"DESCRIPTION"}`);
      console.log("─".repeat(60));
      for (const s of secrets) {
        console.log(`  ${s.name.padEnd(24)} ${s.description || "—"}`);
      }
      console.log();
    });

  cmd
    .command("delete <name>")
    .description("Delete a secret")
    .option("--company <id>", "Company ID")
    .action(async (name, opts) => {
      const companyId = await resolveCompany(opts.company);
      const { message } = await api<{ message: string }>(`/v1/secrets/${name}?companyId=${companyId}`, "DELETE");
      console.log(message);
    });

  return cmd;
}
