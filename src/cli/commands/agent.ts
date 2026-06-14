import { Command } from "commander";
import { loadConfig } from "../../utils/config.js";
import { isSupportedModelProvider, isValidModel } from "../../agents/validation.js";
import { resolveCompany } from "../../utils/company.js";
import {
  resolveProvidersAvailability,
  type AvailabilityStatus,
} from "../provider-status.js";


const EDITABLE_STATUSES = new Set(["idle", "active", "paused", "terminated"]);

type AgentEditOptions = {
  company: string;
  name?: string;
  role?: string;
  description?: string;
  model?: string;
  provider?: string;
  promptFile?: string;
  systemPromptFile?: string;
  reportsTo?: string;
  heartbeat?: string;
  status?: string;
  maxConcurrent?: string;
  permissions?: string;
};

function requireNonEmptyString(value: string | undefined, field: string): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function parseJsonObject(value: string): Record<string, boolean> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("permissions must be a valid JSON object");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("permissions must be a JSON object with boolean values");
  }

  for (const [key, entry] of Object.entries(parsed)) {
    if (typeof entry !== "boolean") {
      throw new Error(`permissions.${key} must be boolean`);
    }
  }

  return parsed as Record<string, boolean>;
}

export function buildAgentEditPayload(opts: AgentEditOptions): Record<string, unknown> {
  const payload: Record<string, unknown> = { companyId: requireNonEmptyString(opts.company, "companyId") };

  if (opts.name !== undefined) {
    payload.name = requireNonEmptyString(opts.name, "name");
  }

  const roleOrDescription = opts.role ?? opts.description;
  if (roleOrDescription !== undefined) {
    payload.role = requireNonEmptyString(roleOrDescription, "role");
  }

  if (opts.model !== undefined) {
    const model = requireNonEmptyString(opts.model, "model");
    if (!isValidModel(model)) {
      throw new Error(`Invalid model format: ${model}`);
    }
    payload.model = model;
  }

  if (opts.provider !== undefined) {
    const provider = requireNonEmptyString(opts.provider, "modelProvider");
    if (!isSupportedModelProvider(provider)) {
      throw new Error(`Unsupported model provider: ${provider}`);
    }
    payload.modelProvider = provider;
  }

  const promptFile = opts.promptFile ?? opts.systemPromptFile;
  if (promptFile !== undefined) {
    payload.promptFile = promptFile.trim().toLowerCase() === "null"
      ? null
      : requireNonEmptyString(promptFile, "promptFile");
  }

  if (opts.reportsTo !== undefined) {
    payload.reportsTo = opts.reportsTo.trim().toLowerCase() === "null"
      ? null
      : requireNonEmptyString(opts.reportsTo, "reportsTo");
  }

  if (opts.heartbeat !== undefined) {
    payload.heartbeatCron = opts.heartbeat.trim().toLowerCase() === "null"
      ? null
      : requireNonEmptyString(opts.heartbeat, "heartbeat");
  }

  if (opts.status !== undefined) {
    const status = requireNonEmptyString(opts.status, "status");
    if (!EDITABLE_STATUSES.has(status)) {
      throw new Error(`Invalid status: ${status}`);
    }
    payload.status = status;
  }

  if (opts.maxConcurrent !== undefined) {
    const value = Number.parseInt(opts.maxConcurrent, 10);
    if (!Number.isInteger(value) || value < 1) {
      throw new Error("max-concurrent must be an integer >= 1");
    }
    payload.maxConcurrent = value;
  }

  if (opts.permissions !== undefined) {
    payload.permissions = parseJsonObject(opts.permissions);
  }

  return payload;
}

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

const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

function availabilityMark(status: AvailabilityStatus): string {
  switch (status) {
    case "ready":
      return "\x1b[32m✓\x1b[0m";
    case "missing":
      return "\x1b[31m✗\x1b[0m";
    default:
      return `${DIM}◦${RESET}`;
  }
}

function colorAgentStatus(status: string): string {
  if (status === "idle") return `\x1b[32m${status}\x1b[0m`;
  if (status === "active") return `\x1b[33m${status}\x1b[0m`;
  if (status === "paused") return `\x1b[31m${status}\x1b[0m`;
  return status;
}

/**
 * Render the conductor routing table: every agent and the backend it is wired
 * to, with a mark showing whether that backend is actually usable here.
 */
function printRoutingTable(agents: any[]): void {
  const availability = resolveProvidersAvailability(
    agents.map((a) => a.modelProvider).filter(Boolean),
  );

  const rule = "─".repeat(72);
  console.log("\nConductor routing\n" + rule);
  console.log(`    ${"AGENT".padEnd(18)}${"PROVIDER".padEnd(16)}${"MODEL".padEnd(20)}STATUS`);
  console.log(rule);

  for (const a of agents) {
    const avail = availability.get(a.modelProvider);
    const mark = avail ? availabilityMark(avail.status) : " ";
    const provider = String(a.modelProvider ?? "—").padEnd(16);
    const model = String(a.model ?? "—").padEnd(20);
    console.log(`  ${mark} ${String(a.slug).padEnd(18)}${provider}${model}${colorAgentStatus(a.status)}`);
  }

  console.log(rule);
  console.log(
    `  ${DIM}legend:${RESET} \x1b[32m✓\x1b[0m ready   \x1b[31m✗\x1b[0m backend missing   ${DIM}◦ endpoint (not probed)${RESET}`,
  );

  // Surface unusable backends as actionable hints.
  const missing = [...availability.values()].filter((v) => v.status === "missing");
  if (missing.length) {
    console.log();
    for (const m of missing) {
      const usedBy = agents.filter((a) => a.modelProvider === m.provider).map((a) => a.slug);
      console.log(`  \x1b[31m✗\x1b[0m ${m.provider}: ${m.detail} — needed by: ${usedBy.join(", ")}`);
    }
  }
  console.log();
}

export function agentCommand(): Command {
  const cmd = new Command("agent").description("Manage agents");

  cmd
    .command("list")
    .description("List all agents and the backend each is routed to")
    .option("--company <id>", "Company ID")
    .action(async (opts) => {
      const companyId = await resolveCompany(opts.company);
      const params = `?companyId=${companyId}`;
      const { agents } = await api<{ agents: any[] }>(`/v1/agents${params}`);
      if (!agents.length) {
        console.log("No agents found.");
        return;
      }
      printRoutingTable(agents);
    });

  cmd
    .command("inspect <slug>")
    .description("Show agent details")
    .option("--company <id>", "Company ID")
    .action(async (slug, opts) => {
      const companyId = await resolveCompany(opts.company);
      const params = `?companyId=${companyId}`;
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
    .command("hire [slug]")
    .description("Hire a new agent")
    .option("--company <id>", "Company ID")
    .option("--name <name>", "Display name")
    .option("--role <role>", "Role")
    .option("--model <model>", "Model")
    .option("--provider <p>", "Model provider")
    .option("--reports-to <slug>", "Parent agent slug")
    .option("--cron <expr>", "Heartbeat cron")
    .action(async (slugArg, opts) => {
      const companyId = await resolveCompany(opts.company);
      
      let slug = slugArg;
      let { name, role, model, provider, reportsTo, cron } = opts;

      const isInteractive = !slug || !name || !role || !provider || !model;
      
      if (isInteractive) {
        const { intro, text, select, p } = await import("../prompts.js");
        intro("Hire a New Agent");
        
        if (!slug) {
          slug = await text({
            message: "Agent slug (e.g. frontend_dev):",
            validate: (v) => (!v ? "Slug is required" : undefined)
          });
        }
        
        if (!name) {
          name = await text({
            message: "Display name:",
            defaultValue: slug,
          });
        }

        if (!role) {
          role = await select({
            message: "Role:",
            options: [
              { value: "engineer", label: "Engineer" },
              { value: "designer", label: "Designer" },
              { value: "pm", label: "Product Manager" },
              { value: "qa", label: "QA" },
              { value: "devops", label: "DevOps" },
              { value: "researcher", label: "Researcher" },
              { value: "general", label: "General" }
            ]
          });
        }

        if (!provider) {
          provider = await select({
            message: "Model Provider (backend this agent runs on):",
            options: [
              { value: "claude-cli", label: "Claude Code CLI" },
              { value: "gemini-cli", label: "Gemini CLI" },
              { value: "codex-cli", label: "Codex CLI" },
              { value: "opencode-cli", label: "opencode CLI" },
              { value: "ollama", label: "Ollama (local endpoint)" },
              { value: "anthropic-api", label: "Anthropic API" },
              { value: "gemini-api", label: "Gemini API" },
              { value: "openrouter", label: "OpenRouter API" },
              { value: "cursor", label: "Cursor (HTTP endpoint)" }
            ]
          });
        }

        if (!model) {
          model = await text({
            message: `Model for ${provider}:`,
            defaultValue: provider.includes("claude") || provider.includes("anthropic") ? "sonnet" : "default"
          });
        }
        
        if (!reportsTo) {
          const { agents } = await api<{ agents: any[] }>(`/v1/agents?companyId=${companyId}`);
          if (agents.length > 0) {
            const reportOptions = [{ value: "none", label: "None (Top Level)" }];
            for (const a of agents) {
              reportOptions.push({ value: a.slug, label: `${a.name} (@${a.slug})` });
            }
            const rep = await select({
              message: "Reports to:",
              options: reportOptions
            });
            reportsTo = rep === "none" ? undefined : rep;
          }
        }
        
        if (!cron) {
          const addCron = await p.confirm({ message: "Configure heartbeat cron?" });
          if (!p.isCancel(addCron) && addCron) {
            cron = await text({
              message: "Cron expression (e.g. 0 */6 * * *):",
            });
          }
        }
      }

      if (!slug || !name || !role || !provider || !model) {
        throw new Error("Missing required arguments.");
      }

      const { agent } = await api<{ agent: any }>("/v1/agents", "POST", {
        companyId,
        slug,
        name,
        role,
        model,
        modelProvider: provider,
        reportsTo,
        heartbeatCron: cron,
      });
      
      console.log();
      console.log(`Agent "\x1b[1m${agent.slug}\x1b[0m" hired successfully (${agent.status}).`);
    });

  cmd
    .command("fire <slug>")
    .description("Terminate an agent")
    .option("--company <id>", "Company ID")
    .action(async (slug, opts) => {
      const companyId = await resolveCompany(opts.company);
      const { message } = await api<{ message: string }>(`/v1/agents/${slug}?companyId=${companyId}`, "DELETE");
      console.log(message);
    });

  cmd
    .command("revisions <slug>")
    .description("List agent config revisions")
    .option("--company <id>", "Company ID")
    .action(async (slug, opts) => {
      const companyId = await resolveCompany(opts.company);
      const params = `?companyId=${companyId}`;
      const { revisions } = await api<{ revisions: any[] }>(`/v1/agents/${slug}/revisions${params}`);
      
      if (!revisions.length) {
        console.log("No revisions found.");
        return;
      }

      console.log("\nRevisions\n" + "─".repeat(80));
      console.log(`  ${"REV".padEnd(4)} ${"CREATED AT".padEnd(24)} ${"CHANGE NOTE"}`);
      console.log("─".repeat(80));
      for (const r of revisions) {
        const date = new Date(r.createdAt).toLocaleString();
        const note = r.changeNote || "—";
        console.log(`  ${r.revision.toString().padEnd(4)} ${date.padEnd(24)} ${note}`);
      }
      console.log();
    });

  cmd
    .command("rollback <slug>")
    .description("Rollback agent config to a specific revision")
    .option("--company <id>", "Company ID")
    .option("--rev <n>", "Revision number")
    .action(async (slug, opts) => {
      const companyId = await resolveCompany(opts.company);
      if (!opts.rev) throw new Error("Revision number (--rev <n>) is required");

      const revNum = parseInt(opts.rev, 10);
      if (isNaN(revNum)) throw new Error("Revision must be a number");

      const { message } = await api<{ message: string }>(`/v1/agents/${slug}/rollback`, "PUT", {
        companyId,
        revision: revNum,
      });
      console.log(message);
    });

  cmd
    .command("edit <slug>")
    .description("Edit an existing agent")
    .requiredOption("--company <id>", "Company ID")
    .option("--name <name>", "Display name")
    .option("--role <role>", "Role")
    .option("--description <text>", "Role/description alias")
    .option("--model <model>", "Model")
    .option("--provider <provider>", "Model provider")
    .option("--prompt-file <path|null>", "Custom prompt file path or null")
    .option("--system-prompt-file <path|null>", "Alias for --prompt-file")
    .option("--reports-to <slug|null>", "Parent agent slug or null")
    .option("--heartbeat <cron|null>", "Heartbeat cron expression or null")
    .option("--status <status>", "Status (idle|active|paused|terminated)")
    .option("--max-concurrent <n>", "Maximum concurrent jobs (integer >= 1)")
    .option("--permissions <json>", "JSON object of permissions")
    .action(async (slug, opts: AgentEditOptions) => {
      const payload = buildAgentEditPayload(opts);
      const changedFields = Object.keys(payload).filter((field) => field !== "companyId");

      if (changedFields.length === 0) {
        throw new Error("No fields to update. Provide at least one editable option.");
      }

      const { agent } = await api<{ agent: { slug: string; updatedAt?: string } }>(`/v1/agents/${slug}`, "PUT", payload);
      console.log(`Agent "${agent.slug}" updated (${changedFields.join(", ")}).`);
    });

  return cmd;
}
