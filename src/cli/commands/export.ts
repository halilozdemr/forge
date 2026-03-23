import { Command } from "commander";
import { resolveCompany } from "../../utils/company.js";
import { loadConfig } from "../../utils/config.js";
import AdmZip from "adm-zip";

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

export function exportCommand(): Command {
  return new Command("export")
    .description("Export company data to a ZIP file")
    .option("--company <id>", "Company ID or slug")
    .option("-o, --output <path>", "Output path")
    .action(async (opts) => {
      try {
        const companyId = await resolveCompany(opts.company);
        console.log(`Exporting data for company ID: ${companyId}...`);

        const data = await api<any>(`/v1/export?companyId=${companyId}`);

        const zip = new AdmZip();

        // company.json (company + agents + budget policies + goals)
        const companyJson = {
          company: {
            id: data.company.id,
            name: data.company.name,
            slug: data.company.slug,
            requireApprovalForNewAgents: data.company.requireApprovalForNewAgents,
            createdAt: data.company.createdAt,
            updatedAt: data.company.updatedAt,
          },
          agents: data.company.agents,
          budgetPolicies: data.company.budgetPolicies,
          goals: data.company.goals,
          secrets: data.company.secrets, // names only, values are redacted
        };
        zip.addFile("company.json", Buffer.from(JSON.stringify(companyJson, null, 2)));

        // projects.json
        zip.addFile("projects.json", Buffer.from(JSON.stringify(data.projects, null, 2)));

        // issues.json (issues + comments + work products + labels)
        const issuesJson = {
          issues: data.issues,
          labels: data.labels,
        };
        zip.addFile("issues.json", Buffer.from(JSON.stringify(issuesJson, null, 2)));

        // sprints.json
        zip.addFile("sprints.json", Buffer.from(JSON.stringify(data.sprints, null, 2)));

        // memory.json
        zip.addFile("memory.json", Buffer.from(JSON.stringify(data.memoryEntries, null, 2)));

        // activity_log.json
        zip.addFile("activity_log.json", Buffer.from(JSON.stringify(data.activityLogs, null, 2)));

        const today = new Date().toISOString().split("T")[0];
        const defaultName = `forge-export-${today}.zip`;
        const outputPath = opts.output || defaultName;

        zip.writeZip(outputPath);
        console.log(`\n\x1b[32m✔ Exported to ${outputPath}\x1b[0m`);
      } catch (err: any) {
        console.error(`\x1b[31mError: ${err.message}\x1b[0m`);
        process.exit(1);
      }
    });
}
