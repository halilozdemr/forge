import { Command } from "commander";
import { loadConfig } from "../../utils/config.js";
import { isSupportedModelProvider, isValidModel } from "../../agents/validation.js";
import { resolveCompany } from "../../utils/company.js";
import { decrypt, redactSecrets } from "../../utils/crypto.js";

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
      const companyId = await resolveCompany(opts.company);
      const params = `?companyId=${companyId}`;
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
            message: "Model Provider:",
            options: [
              { value: "claude-cli", label: "Claude CLI" },
              { value: "anthropic-api", label: "Anthropic API" },
              { value: "openrouter", label: "OpenRouter" },
              { value: "gemini-cli", label: "Gemini CLI" },
              { value: "codex-cli", label: "Codex CLI" }
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
    .command("run <slug>")
    .description("Execute an agent directly and stream output")
    .option("--company <id>", "Company ID")
    .option("--input <input>", "Direct input prompt")
    .option("--issue <issueId>", "Issue ID to work on")
    .option("--stream", "Stream live logs from the agent")
    .action(async (slug, opts) => {
      const companyId = await resolveCompany(opts.company);
      if (!opts.input && !opts.issue) {
        throw new Error("Must provide either --input or --issue");
      }

      const { getDb } = await import("../../db/client.js");
      const db = getDb();
      
      const agent = await db.agent.findUnique({ where: { companyId_slug: { companyId, slug } } });
      if (!agent) throw new Error(`Agent ${slug} not found`);

      const { AgentRegistry } = await import("../../agents/registry.js");
      const registry = new AgentRegistry(db);
      const systemPrompt = await registry.resolvePrompt(agent);

      const config = loadConfig();

      let inputStr = opts.input || "";
      let lockedIssueId: string | null = null;
      let goalContext = "";

      if (opts.issue) {
         const issue = await db.issue.findUnique({ where: { id: opts.issue } });
         if (!issue) throw new Error(`Issue ${opts.issue} not found`);

         const lockResult = await db.issue.updateMany({
           where: { id: opts.issue, executionLockedAt: null },
           data: { executionLockedAt: new Date(), executionAgentSlug: slug }
         });
         if (lockResult.count === 0) {
           throw new Error(`Issue ${opts.issue} is already being executed.`);
         }
         lockedIssueId = opts.issue;

         // Check if goalId exists in schema before using it
         if ((issue as any).goalId) {
           const { buildGoalChainContext } = await import("../../utils/goal.js");
           goalContext = await buildGoalChainContext(db, (issue as any).goalId);
         }

         const issueContext = `Execute issue: ${issue.title}\n\n${issue.description ?? ""}`;
         inputStr = goalContext 
           ? `${goalContext}\n${issueContext}\n\n${inputStr}`
           : `${issueContext}\n\n${inputStr}`;
      }

      // Fetch and decrypt secrets
      const companySecrets = await db.companySecret.findMany({ where: { companyId } });
      const secrets: Record<string, string> = {};
      for (const s of companySecrets) {
        try {
          secrets[s.name] = decrypt(s.value);
        } catch (e) {
          // silently ignore decryption errors here
        }
      }

      // Resolve placeholders in systemPrompt and inputStr
      let finalSystemPrompt = systemPrompt;
      for (const [name, value] of Object.entries(secrets)) {
        const placeholder = new RegExp(`{{secrets\.${name}}}`, 'g');
        finalSystemPrompt = finalSystemPrompt.replace(placeholder, value);
        inputStr = inputStr.replace(placeholder, value);
      }

      console.log(`\n\x1b[1m🚀 Starting direct execution for @${slug}\x1b[0m\n`);

      const { createRunner } = await import("../../bridge/runners/factory.js");
      const runner = createRunner(agent.modelProvider);
      
      try {
        const result = await runner.run({
          projectPath: config.projectPath,
          agentSlug: slug,
          model: agent.model,
          systemPrompt: finalSystemPrompt,
          input: inputStr,
          permissions: JSON.parse(agent.permissions),
          adapterConfig: JSON.parse((agent as any).adapterConfig || "{}"),
          env: secrets,
          onStream: (chunk) => {
            const redacted = redactSecrets(chunk, secrets);
            process.stdout.write(redacted);

            if (opts.stream) {
              // Emit to WebSocket via API
              const eventLine = redacted.trim();
              if (eventLine) {
                api("/v1/events/emit", "POST", {
                  type: "heartbeat.log",
                  agentSlug: slug,
                  line: eventLine
                }).catch(() => {}); // fire and forget
              }
            }
          },
        });

        console.log(`\n\n\x1b[1m✨ Execution complete (${result.durationMs}ms)\x1b[0m`);
        if (!result.success) {
          console.error(`\x1b[31mError: ${result.error}\x1b[0m`);
        }
      } finally {
        if (lockedIssueId) {
          await db.issue.update({
            where: { id: lockedIssueId },
            data: { executionLockedAt: null, executionAgentSlug: null, executionJobId: null }
          });
        }
      }
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
