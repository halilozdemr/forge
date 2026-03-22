import { Command } from "commander";
import { loadConfig } from "../../utils/config.js";
import { buildHierarchy, formatHierarchy } from "../../agents/hierarchy.js";
import { resolveCompany } from "../../utils/company.js";
import { decrypt, redactSecrets } from "../../utils/crypto.js";

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

  return cmd;
}
