import { Command } from "commander";
import { loadConfig } from "../../utils/config.js";
import { buildHierarchy, formatHierarchy } from "../../agents/hierarchy.js";

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

export function agentCommand(): Command {
  const cmd = new Command("agent").description("Manage agents");

  cmd
    .command("list")
    .description("List all agents")
    .option("--company <id>", "Company ID")
    .action(async (opts) => {
      const params = opts.company ? `?companyId=${opts.company}` : "";
      const { agents } = await api<{ agents: any[] }>(`/v1/agents${params}`);
      if (!agents.length) {
        console.log("No agents found.");
        return;
      }
      console.log("\nAgents\n" + "─".repeat(60));
      for (const a of agents) {
        const status = a.status === "idle" ? "\x1b[32midle\x1b[0m"
          : a.status === "active" ? "\x1b[33mactive\x1b[0m"
          : a.status === "paused" ? "\x1b[31mpaused\x1b[0m"
          : a.status;
        console.log(`  ${a.slug.padEnd(16)} ${a.name.padEnd(24)} ${status}`);
      }
      console.log();
    });

  cmd
    .command("inspect <slug>")
    .description("Show agent details")
    .option("--company <id>", "Company ID")
    .action(async (slug, opts) => {
      const params = opts.company ? `?companyId=${opts.company}` : "";
      const { agent, escalationChain } = await api<{ agent: any; escalationChain: string[] }>(
        `/v1/agents/${slug}${params}`
      );
      console.log("\n" + "─".repeat(60));
      console.log(`Slug:       ${agent.slug}`);
      console.log(`Name:       ${agent.name}`);
      console.log(`Role:       ${agent.role}`);
      console.log(`Status:     ${agent.status}`);
      console.log(`Provider:   ${agent.modelProvider}`);
      console.log(`Model:      ${agent.model}`);
      console.log(`Reports to: ${agent.reportsTo ?? "—"}`);
      console.log(`Heartbeat:  ${agent.heartbeatCron ?? "disabled"}`);
      console.log(`Chain:      ${escalationChain.join(" → ")}`);
      console.log();
    });

  cmd
    .command("hire <slug>")
    .description("Hire a new agent")
    .requiredOption("--company <id>", "Company ID")
    .requiredOption("--name <name>", "Display name")
    .option("--model <model>", "Model", "sonnet")
    .option("--provider <p>", "Model provider (claude-cli|openrouter|anthropic-api)", "claude-cli")
    .option("--reports-to <slug>", "Parent agent slug")
    .action(async (slug, opts) => {
      const { agent } = await api<{ agent: any }>("/v1/agents", "POST", {
        companyId: opts.company,
        slug,
        name: opts.name,
        role: opts.name,
        model: opts.model,
        modelProvider: opts.provider,
        reportsTo: opts.reportsTo,
      });
      console.log(`Agent "${agent.slug}" hired (${agent.status}).`);
    });

  cmd
    .command("fire <slug>")
    .description("Terminate an agent")
    .requiredOption("--company <id>", "Company ID")
    .action(async (slug, opts) => {
      const { message } = await api<{ message: string }>(`/v1/agents/${slug}?companyId=${opts.company}`, "DELETE");
      console.log(message);
    });

  return cmd;
}
