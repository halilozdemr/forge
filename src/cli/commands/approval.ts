import { Command } from "commander";
import { resolveCompany } from "../../utils/company.js";
import { createChildLogger } from "../../utils/logger.js";
import { loadConfig } from "../../utils/config.js";

const log = createChildLogger("approval-cli");

const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";
const DIM = "\x1b[90m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";

function relativeTime(date: string): string {
  const secs = Math.round((Date.now() - new Date(date).getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function baseUrl(): string {
  return `http://localhost:${loadConfig().port}`;
}

export function approvalCommand() {
  const approval = new Command("approval").description("Manage approval gates");

  approval
    .command("inbox")
    .description("Show pending approvals with context")
    .option("--company <id>", "Company ID or slug")
    .option("--status <status>", "Filter by status (pending|approved|rejected)", "pending")
    .action(async (opts) => {
      try {
        const companyId = await resolveCompany(opts.company);
        const url = new URL(`${baseUrl()}/v1/approvals/inbox`);
        url.searchParams.set("companyId", companyId);
        url.searchParams.set("status", opts.status);

        const res = await fetch(url.toString());
        const data = await res.json() as { approvals?: any[]; error?: string };

        if (!res.ok) {
          console.error(`${RED}Error: ${data.error ?? res.statusText}${RESET}`);
          process.exit(1);
        }

        const approvals = data.approvals ?? [];
        if (approvals.length === 0) {
          console.log(`No ${opts.status} approvals.`);
          return;
        }

        console.log(`\n${BOLD}Approval Inbox${RESET}  (${approvals.length} ${opts.status})\n` + "─".repeat(70));

        for (const a of approvals) {
          const typeColor = a.type === "hire_agent" ? YELLOW : a.type === "budget_override" ? RED : DIM;
          console.log(`  ${typeColor}[${a.type}]${RESET}  ${BOLD}${a.description}${RESET}`);
          console.log(`  ${DIM}Requested by ${a.requestedBy} · ${relativeTime(a.requestedAt)} · id: ${a.id}${RESET}`);
          if (a.status === "pending") {
            console.log(`  ${GREEN}→ forge approval approve ${a.id}${RESET}`);
            console.log(`  ${RED}→ forge approval reject  ${a.id} [--reason "..."]${RESET}`);
          }
          console.log();
        }
      } catch (error: any) {
        console.error(`${RED}Error: ${error.message}${RESET}`);
        process.exit(1);
      }
    });

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
