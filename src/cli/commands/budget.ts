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

export function budgetCommand(): Command {
  const cmd = new Command("budget").description("Manage budgets");

  cmd
    .command("set <limitUsd>")
    .description("Set monthly budget limit")
    .requiredOption("--company <id>", "Company ID")
    .option("--agent <slug>", "Limit to specific agent slug")
    .option("--soft-pct <pct>", "Soft limit percentage (default: 80)", "80")
    .option("--action <action>", "Action on hard limit: warn|pause|block (default: pause)", "pause")
    .action(async (limitUsd, opts) => {
      const body: Record<string, unknown> = {
        companyId: opts.company,
        monthlyLimitUsd: parseFloat(limitUsd),
        softLimitPct: parseInt(opts.softPct, 10),
        action: opts.action,
      };
      if (opts.agent) {
        body.scope = "agent";
        body.scopeId = opts.agent;
      } else {
        body.scope = "company";
      }
      const { policy } = await api<{ policy: any }>("/v1/budget/policies", "POST", body);
      const target = opts.agent ? `agent:${opts.agent}` : `company:${opts.company}`;
      console.log(`Budget set: $${policy.monthlyLimitUsd}/month for ${target} (soft: ${policy.softLimitPct}%, action: ${policy.action})`);
    });

  cmd
    .command("show")
    .description("Show current budget policies and usage")
    .requiredOption("--company <id>", "Company ID")
    .action(async (opts) => {
      const { policies, usage } = await api<{ policies: any[]; usage: any }>(`/v1/budget/usage?companyId=${opts.company}`);

      console.log("\nBudget Overview\n" + "─".repeat(60));
      console.log(`Company:   ${opts.company}`);
      console.log(`This Month: $${Number(usage?.totalUsd ?? 0).toFixed(4)}`);
      console.log();

      if (policies.length) {
        console.log("Policies:");
        for (const p of policies) {
          const target = p.scope === "agent" ? `  agent:${p.scopeId}` : "  company";
          const pct = usage?.totalUsd && p.monthlyLimitUsd
            ? Math.round((Number(usage.totalUsd) / Number(p.monthlyLimitUsd)) * 100)
            : 0;
          console.log(`  ${target.padEnd(24)} $${Number(p.monthlyLimitUsd).toFixed(2)}/month  ${pct}% used  [${p.action}]`);
        }
      } else {
        console.log("No budget policies configured.");
      }
      console.log();
    });

  cmd
    .command("report")
    .description("Show cost report by agent")
    .requiredOption("--company <id>", "Company ID")
    .option("--month <yyyy-mm>", "Month to report (default: current)")
    .action(async (opts) => {
      const params = new URLSearchParams({ companyId: opts.company });
      if (opts.month) params.set("month", opts.month);

      const { events, summary } = await api<{ events: any[]; summary: any }>(`/v1/budget/report?${params}`);

      console.log(`\nCost Report — ${opts.month ?? new Date().toISOString().slice(0, 7)}\n` + "─".repeat(60));
      console.log(`Total: $${Number(summary?.totalUsd ?? 0).toFixed(4)} (${summary?.totalTokens ?? 0} tokens)`);
      console.log();

      if (events.length) {
        const byAgent: Record<string, { usd: number; tokens: number }> = {};
        for (const e of events) {
          if (!byAgent[e.agentId]) byAgent[e.agentId] = { usd: 0, tokens: 0 };
          byAgent[e.agentId].usd += Number(e.costUsd);
          byAgent[e.agentId].tokens += e.inputTokens + e.outputTokens;
        }
        console.log("By agent:");
        for (const [agentId, data] of Object.entries(byAgent).sort((a, b) => b[1].usd - a[1].usd)) {
          console.log(`  ${agentId.padEnd(24)} $${data.usd.toFixed(4)}  ${data.tokens} tokens`);
        }
      }
      console.log();
    });

  return cmd;
}
