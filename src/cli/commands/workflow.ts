import { Command } from "commander";
import { loadConfig } from "../../utils/config.js";

function baseUrl(): string {
  return `http://localhost:${loadConfig().port}`;
}

async function api<T>(path: string): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`);
  if (!res.ok) {
    const err = (await res.json()) as { error: string };
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

const STATUS_COLORS: Record<string, string> = {
  pending: "\x1b[90m",
  running: "\x1b[33m",
  completed: "\x1b[32m",
  failed: "\x1b[31m",
  cancelled: "\x1b[35m",
};
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

function colorStatus(status: string, pad = 0): string {
  const c = STATUS_COLORS[status] ?? "";
  const s = pad > 0 ? status.padEnd(pad) : status;
  return `${c}${s}${RESET}`;
}

function formatDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString();
}

function progressBar(completed: number, total: number): string {
  if (total === 0) return "no steps";
  const pct = Math.round((completed / total) * 100);
  const filled = Math.round((completed / total) * 10);
  const bar = "█".repeat(filled) + "░".repeat(10 - filled);
  return `${bar} ${completed}/${total} (${pct}%)`;
}

export function workflowCommand(): Command {
  const cmd = new Command("workflow")
    .description("Inspect workflow runs (list, show, watch)")
    .addHelpText(
      "after",
      `
Use this command group to inspect progress.
To start new work, use:
  forge run "add login screen" --type feature --mode structured
  forge run "fix crash on launch" --type bug --mode fast
`,
    );

  cmd
    .command("list")
    .description("List workflow runs")
    .option("--status <status>", "Filter by status (pending|running|completed|failed|cancelled)")
    .option("--type <type>", "Filter by work kind (feature|bug|refactor|release|direct)")
    .option("--company <id>", "Company ID")
    .option("--project <id>", "Project ID")
    .option("--limit <n>", "Max results", "30")
    .action(async (opts) => {
      try {
        const params = new URLSearchParams();
        if (opts.status) params.set("status", opts.status);
        if (opts.type) params.set("type", opts.type);
        if (opts.company) params.set("companyId", opts.company);
        if (opts.project) params.set("projectId", opts.project);
        if (opts.limit) params.set("limit", opts.limit);

        const { workflows } = await api<{ workflows: any[] }>(`/v1/workflows?${params}`);

        if (!workflows.length) {
          console.log("No workflow runs found.");
          return;
        }

        console.log(`\n${BOLD}Workflow Runs${RESET}\n` + "─".repeat(80));
        for (const w of workflows) {
          const progress = progressBar(w.progress.completed, w.progress.total);
          const title = w.issueTitle ? `"${w.issueTitle.slice(0, 30)}"` : w.id;
          console.log(
            `  ${colorStatus(w.status, 20)} ${w.type.padEnd(10)} ${title.padEnd(34)} ${progress}`
          );
          console.log(`  \x1b[90m  id: ${w.id}  started: ${formatDate(w.startedAt)}${RESET}`);
        }
        console.log();
      } catch (err: any) {
        console.error(`\x1b[31mError: ${err.message}\x1b[0m`);
        process.exit(1);
      }
    });

  cmd
    .command("show <id>")
    .description("Show workflow run details and step timeline")
    .action(async (id) => {
      try {
        const { workflow: w } = await api<{ workflow: any }>(`/v1/workflows/${id}`);

        console.log("\n" + "─".repeat(70));
        console.log(`${BOLD}Workflow Run${RESET}  ${w.id}`);
        console.log(`Kind:      ${w.type}`);
        console.log(`Status:    ${colorStatus(w.status)}`);
        console.log(`Progress:  ${progressBar(w.progress.completed, w.progress.total)}`);
        if (w.issue) console.log(`Issue:     ${w.issue.title} [${w.issue.type}]`);
        console.log(`Entry:     ${w.entryAgentSlug}`);
        if (w.currentStepKey) console.log(`Current:   ${w.currentStepKey}`);
        console.log(`Started:   ${formatDate(w.startedAt)}`);
        if (w.completedAt) console.log(`Completed: ${formatDate(w.completedAt)}`);
        if (w.lastError) console.log(`\n\x1b[31mError: ${w.lastError}${RESET}`);

        if (w.steps?.length) {
          console.log(`\n${BOLD}Steps${RESET}\n` + "─".repeat(70));
          for (const s of w.steps) {
            const duration =
              s.startedAt && s.completedAt
                ? `${Math.round((new Date(s.completedAt).getTime() - new Date(s.startedAt).getTime()) / 1000)}s`
                : "";
            console.log(
              `  ${colorStatus(s.status, 20)} ${s.stepKey.padEnd(20)} ${s.agentSlug.padEnd(20)} ${duration}`
            );
            if (s.resultSummary) {
              console.log(`     \x1b[90m${s.resultSummary.slice(0, 120)}${RESET}`);
            }
          }
        }
        console.log();
      } catch (err: any) {
        console.error(`\x1b[31mError: ${err.message}\x1b[0m`);
        process.exit(1);
      }
    });

  cmd
    .command("watch <id>")
    .description("Watch a workflow run until it reaches a terminal state")
    .option("--interval <ms>", "Poll interval in milliseconds", "3000")
    .action(async (id, opts) => {
      const intervalMs = parseInt(opts.interval, 10) || 3000;
      const TERMINAL = new Set(["completed", "failed", "cancelled"]);

      console.log(`Watching workflow ${BOLD}${id}${RESET} — press Ctrl+C to stop\n`);

      let lastStatus = "";
      let lastStepKey: string | null = null;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        let w: any;
        try {
          ({ workflow: w } = await api<{ workflow: any }>(`/v1/workflows/${id}`));
        } catch (err: any) {
          console.error(`\x1b[31mError: ${err.message}${RESET}`);
          process.exit(1);
        }

        const changed = w.status !== lastStatus || w.currentStepKey !== lastStepKey;
        if (changed) {
          const ts = new Date().toLocaleTimeString();
          const progress = progressBar(w.progress.completed, w.progress.total);
          console.log(
            `[${ts}] ${colorStatus(w.status, 20)} step: ${(w.currentStepKey ?? "—").padEnd(20)} ${progress}`
          );
          lastStatus = w.status;
          lastStepKey = w.currentStepKey ?? null;
        }

        if (TERMINAL.has(w.status)) {
          console.log(`\nWorkflow ${w.status.toUpperCase()}.`);
          if (w.lastError) console.log(`\x1b[31mError: ${w.lastError}${RESET}`);
          break;
        }

        await new Promise((r) => setTimeout(r, intervalMs));
      }
    });

  return cmd;
}
