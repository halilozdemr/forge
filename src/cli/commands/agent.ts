import { Command } from "commander";
import { loadConfig } from "../../utils/config.js";
import { isSupportedModelProvider, isValidModel } from "../../agents/validation.js";

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
