import { Command } from "commander";
import { resolveCompany } from "../../utils/company.js";
import { createChildLogger } from "../../utils/logger.js";
import { loadConfig } from "../../utils/config.js";

const log = createChildLogger("approval-cli");

function baseUrl(): string {
  return `http://localhost:${loadConfig().port}`;
}

export function approvalCommand() {
  const approval = new Command("approval").description("Manage approval gates");

  approval
    .command("list")
    .description("List pending approvals")
    .option("--status <status>", "Filter by status (pending, approved, rejected, cancelled)", "pending")
    .option("--company <id>", "Company ID or slug")
    .action(async (opts) => {
      try {
        const companyId = await resolveCompany(opts.company);
        const url = new URL(`${baseUrl()}/v1/approvals`);
        url.searchParams.append("companyId", companyId);
        url.searchParams.append("status", opts.status);

        const res = await fetch(url.toString());
        const data = await res.json();

        if (!res.ok) {
          console.error(`Error: ${data.error || res.statusText}`);
          return;
        }

        const approvals = data.approvals;
        if (approvals.length === 0) {
          console.log(`No ${opts.status} approvals found.`);
          return;
        }

        console.table(
          approvals.map((a: any) => ({
            ID: a.id,
            Type: a.type,
            RequestedBy: a.requestedBy,
            RequestedAt: new Date(a.requestedAt).toLocaleString(),
          }))
        );
      } catch (error: any) {
        console.error(`Error: ${error.message}`);
      }
    });

  approval
    .command("approve <id>")
    .description("Approve a request")
    .action(async (id) => {
      try {
        const res = await fetch(`${baseUrl()}/v1/approvals/${id}/approve`, {
          method: "POST",
        });
        const data = await res.json();

        if (!res.ok) {
          console.error(`Error: ${data.error || res.statusText}`);
          return;
        }

        console.log(`Successfully approved: ${data.message || id}`);
      } catch (error: any) {
        console.error(`Error: ${error.message}`);
      }
    });

  approval
    .command("reject <id>")
    .description("Reject a request")
    .option("--reason <reason>", "Reason for rejection")
    .action(async (id, opts) => {
      try {
        const res = await fetch(`${baseUrl()}/v1/approvals/${id}/reject`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: opts.reason }),
        });
        const data = await res.json();

        if (!res.ok) {
          console.error(`Error: ${data.error || res.statusText}`);
          return;
        }

        console.log(`Successfully rejected: ${data.message || id}`);
      } catch (error: any) {
        console.error(`Error: ${error.message}`);
      }
    });

  return approval;
}
