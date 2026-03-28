import { Command } from "commander";
import { loadConfig } from "../../utils/config.js";
import {
  createExecutionModeOption,
  describeExecutionMode,
  resolveExecutionMode,
  type ExecutionMode,
} from "../execution-mode.js";

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

async function submitBug(title: string, description: string | undefined, mode: ExecutionMode): Promise<IntakeResult> {
  return api<IntakeResult>("/v1/intake/requests", "POST", {
    source: "cli",
    type: "bug",
    title,
    description,
    executionMode: mode,
    requestedBy: "cli",
  });
}

function printIntakeResult(result: IntakeResult, mode: ExecutionMode, modeSource: "flag" | "prompt" | "default"): void {
  const defaultNote = modeSource === "default" ? " (defaulted for non-interactive run)" : "";

  console.log(`\n  Issue:   ${result.issueId}`);
  console.log(`  Mode:    ${describeExecutionMode(mode)}${defaultNote}`);
  console.log(`  Run ID:  ${result.pipelineRunId}`);
  console.log(`  Status:  ${result.status}`);
  console.log(`  Steps:   ${result.queuedStepKeys.join(" → ") || "(none queued)"}`);
  console.log(`\n  Watch:   \x1b[1mforge workflow watch ${result.pipelineRunId}\x1b[0m`);
  console.log(`  Inspect: \x1b[1mforge workflow show ${result.pipelineRunId}\x1b[0m\n`);
}

function resolveBugTitle(titleArg?: string, titleOpt?: string): string {
  const title = titleOpt?.trim() || titleArg?.trim();
  if (!title) {
    throw new Error('Bug title is required. Use `forge bug create "..."` or `--title "..."`.');
  }
  return title;
}

export function bugCommand(): Command {
  const cmd = new Command("bug")
    .description("Start and track bug-fix work")
    .addHelpText(
      "after",
      `
Examples:
  forge bug create "fix crash on launch"
  forge bug create "fix crash on launch" --mode structured
  forge bug run --title "fix crash on launch" --mode fast
`,
    );

  cmd
    .command("create")
    .description("Create a bug report and start work")
    .argument("[title]", "Bug title")
    .option("--title <title>", "Bug title (optional if positional title is provided)")
    .option("--description <desc>", "Bug description / reproduction steps")
    .addOption(createExecutionModeOption())
    .action(async (titleArg, opts) => {
      try {
        const title = resolveBugTitle(titleArg, opts.title);
        const modeSelection = await resolveExecutionMode(opts.mode);
        const result = await submitBug(title, opts.description, modeSelection.mode);
        console.log("\x1b[32mBug request created.\x1b[0m");
        printIntakeResult(result, modeSelection.mode, modeSelection.source);
      } catch (err: any) {
        console.error(`\x1b[31mError: ${err.message}\x1b[0m`);
        process.exit(1);
      }
    });

  cmd
    .command("run")
    .description("Start bug-fix work now")
    .argument("[title]", "Bug title")
    .option("--title <title>", "Bug title (optional if positional title is provided)")
    .option("--description <desc>", "Bug description / reproduction steps")
    .addOption(createExecutionModeOption())
    .action(async (titleArg, opts) => {
      try {
        const title = resolveBugTitle(titleArg, opts.title);
        const modeSelection = await resolveExecutionMode(opts.mode);
        const result = await submitBug(title, opts.description, modeSelection.mode);
        console.log("\x1b[32mBug workflow started.\x1b[0m");
        printIntakeResult(result, modeSelection.mode, modeSelection.source);
      } catch (err: any) {
        console.error(`\x1b[31mError: ${err.message}\x1b[0m`);
        process.exit(1);
      }
    });

  return cmd;
}
