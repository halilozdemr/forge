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

type IntakeResult = {
  issueId: string;
  pipelineRunId: string;
  status: string;
  entryAgentSlug: string;
  queuedStepKeys: string[];
};

async function submitBug(title: string, description?: string): Promise<IntakeResult> {
  return api<IntakeResult>("/v1/intake/requests", "POST", {
    source: "cli",
    type: "bug",
    title,
    description,
    requestedBy: "cli",
  });
}

function printIntakeResult(result: IntakeResult): void {
  console.log(`\n  Issue:   ${result.issueId}`);
  console.log(`  Run ID:  ${result.pipelineRunId}`);
  console.log(`  Status:  ${result.status}`);
  console.log(`  Steps:   ${result.queuedStepKeys.join(" → ") || "(none queued)"}`);
  console.log(`\n  Watch:   \x1b[1mforge workflow watch ${result.pipelineRunId}\x1b[0m\n`);
}

export function bugCommand(): Command {
  const cmd = new Command("bug").description("Bug workflow commands");

  cmd
    .command("create")
    .description("Create a bug report and start a workflow run (intake-first)")
    .requiredOption("--title <title>", "Bug title")
    .option("--description <desc>", "Bug description / reproduction steps")
    .action(async (opts) => {
      try {
        const result = await submitBug(opts.title, opts.description);
        console.log("\x1b[32mBug submitted.\x1b[0m");
        printIntakeResult(result);
      } catch (err: any) {
        console.error(`\x1b[31mError: ${err.message}\x1b[0m`);
        process.exit(1);
      }
    });

  cmd
    .command("run")
    .description("Start a bug fix workflow run now (intake-first)")
    .requiredOption("--title <title>", "Bug title")
    .option("--description <desc>", "Bug description / reproduction steps")
    .action(async (opts) => {
      try {
        const result = await submitBug(opts.title, opts.description);
        console.log("\x1b[32mBug workflow started.\x1b[0m");
        printIntakeResult(result);
      } catch (err: any) {
        console.error(`\x1b[31mError: ${err.message}\x1b[0m`);
        process.exit(1);
      }
    });

  return cmd;
}
