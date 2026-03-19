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

export function companyCommand(): Command {
  const cmd = new Command("company").description("Manage companies");

  cmd
    .command("list")
    .description("List all companies")
    .action(async () => {
      const { companies } = await api<{ companies: any[] }>("/v1/companies");
      if (!companies.length) {
        console.log("No companies found.");
        return;
      }
      console.log("\nCompanies\n" + "─".repeat(50));
      for (const c of companies) {
        console.log(`  ${c.slug.padEnd(20)} ${c.name}`);
      }
      console.log();
    });

  cmd
    .command("create <name>")
    .description("Create a new company")
    .option("--slug <slug>", "Company slug (auto-generated if omitted)")
    .action(async (name, opts) => {
      const slug = opts.slug ?? name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
      const { company } = await api<{ company: any }>("/v1/companies", "POST", { name, slug });
      console.log(`Company created: ${company.slug} — "${company.name}"`);
    });

  return cmd;
}
