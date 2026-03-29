import { Command, Option } from "commander";
import { loadConfig } from "../../utils/config.js";
import {
  createExecutionModeOption,
  describeExecutionMode,
  resolveExecutionMode,
  type ExecutionMode,
} from "../execution-mode.js";

type WorkType = "feature" | "bug" | "refactor" | "release";

type IntakeResult = {
  issueId: string;
  pipelineRunId: string;
  status: string;
  entryAgentSlug: string;
  queuedStepKeys: string[];
};

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

function resolveWorkType(type: string): WorkType {
  if (type === "feature" || type === "bug" || type === "refactor" || type === "release") {
    return type;
  }
  throw new Error(`Unsupported work type "${type}". Use feature, bug, refactor, or release.`);
}

function printIntakeResult(
  result: IntakeResult,
  workType: WorkType,
  mode: ExecutionMode,
  modeSource: "flag" | "prompt" | "default",
): void {
  const defaultNote = modeSource === "default" ? " (defaulted for non-interactive run)" : "";

  console.log(`\n  Issue:   ${result.issueId}`);
  console.log(`  Type:    ${workType}`);
  console.log(`  Mode:    ${describeExecutionMode(mode)}${defaultNote}`);
  console.log(`  Run ID:  ${result.pipelineRunId}`);
  console.log(`  Status:  ${result.status}`);
  console.log(`  Steps:   ${result.queuedStepKeys.join(" → ") || "(none queued)"}`);
  console.log(`\n  Watch:   \x1b[1mforge workflow watch ${result.pipelineRunId}\x1b[0m`);
  console.log(`  Inspect: \x1b[1mforge workflow show ${result.pipelineRunId}\x1b[0m\n`);
}

export function runCommand(): Command {
  return new Command("run")
    .description("Submit work to the Forge pipeline")
    .argument("<description>", "What needs to be done")
    .addOption(
      new Option("--type <type>", "Work type").choices(["feature", "bug", "refactor", "release"]).default("feature"),
    )
    .addOption(createExecutionModeOption())
    .action(async (description: string, opts: { type: string; mode?: string }) => {
      try {
        const type = resolveWorkType(opts.type);
        const modeSelection = await resolveExecutionMode(opts.mode);
        const result = await api<IntakeResult>("/v1/intake/requests", "POST", {
          source: "cli",
          type,
          title: description,
          description,
          executionMode: modeSelection.mode,
          requestedBy: "cli",
        });

        console.log(`\x1b[32m${type[0].toUpperCase()}${type.slice(1)} request created.\x1b[0m`);
        printIntakeResult(result, type, modeSelection.mode, modeSelection.source);
      } catch (err: any) {
        console.error(`\x1b[31mError: ${err.message}\x1b[0m`);
        process.exit(1);
      }
    });
}
