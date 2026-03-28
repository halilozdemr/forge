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

async function submitFeature(title: string, description: string | undefined, mode: ExecutionMode): Promise<IntakeResult> {
  return api<IntakeResult>("/v1/intake/requests", "POST", {
    source: "cli",
    type: "feature",
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

function resolveFeatureTitle(titleArg?: string, titleOpt?: string): string {
  const title = titleOpt?.trim() || titleArg?.trim();
  if (!title) {
    throw new Error('Feature title is required. Use `forge feature create "..."` or `--title "..."`.');
  }
  return title;
}

export function featureCommand(): Command {
  const cmd = new Command("feature")
    .description("Start and track feature work")
    .addHelpText(
      "after",
      `
Examples:
  forge feature create "add login screen"
  forge feature create "add login screen" --mode structured
  forge feature run --title "add login screen" --mode fast
`,
    );

  cmd
    .command("create")
    .description("Create a feature request and start work")
    .argument("[title]", "Feature title")
    .option("--title <title>", "Feature title (optional if positional title is provided)")
    .option("--description <desc>", "Feature description")
    .addOption(createExecutionModeOption())
    .action(async (titleArg, opts) => {
      try {
        const title = resolveFeatureTitle(titleArg, opts.title);
        const modeSelection = await resolveExecutionMode(opts.mode);
        const result = await submitFeature(title, opts.description, modeSelection.mode);
        console.log("\x1b[32mFeature request created.\x1b[0m");
        printIntakeResult(result, modeSelection.mode, modeSelection.source);
      } catch (err: any) {
        console.error(`\x1b[31mError: ${err.message}\x1b[0m`);
        process.exit(1);
      }
    });

  cmd
    .command("run")
    .description("Start feature work now")
    .argument("[title]", "Feature title")
    .option("--title <title>", "Feature title (optional if positional title is provided)")
    .option("--description <desc>", "Feature description")
    .addOption(createExecutionModeOption())
    .action(async (titleArg, opts) => {
      try {
        const title = resolveFeatureTitle(titleArg, opts.title);
        const modeSelection = await resolveExecutionMode(opts.mode);
        const result = await submitFeature(title, opts.description, modeSelection.mode);
        console.log("\x1b[32mFeature workflow started.\x1b[0m");
        printIntakeResult(result, modeSelection.mode, modeSelection.source);
      } catch (err: any) {
        console.error(`\x1b[31mError: ${err.message}\x1b[0m`);
        process.exit(1);
      }
    });

  return cmd;
}
