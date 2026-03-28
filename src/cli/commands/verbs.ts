import { Command } from "commander";
import { loadConfig } from "../../utils/config.js";
import { resolveExecutionMode, describeExecutionMode, type ExecutionMode } from "../execution-mode.js";

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

function printResult(label: string, result: IntakeResult): void {
  console.log(`\n  \x1b[32m${label}\x1b[0m`);
  console.log(`  Issue:   ${result.issueId}`);
  console.log(`  Run ID:  ${result.pipelineRunId}`);
  console.log(`  Steps:   ${result.queuedStepKeys.join(" → ") || "(none queued)"}`);
  console.log(`\n  Watch:   \x1b[1mforge workflow watch ${result.pipelineRunId}\x1b[0m\n`);
}

// forge setup — project initialization alias
export function setupCommand(): Command {
  return new Command("setup")
    .description("Initialize Forge in the current project (alias: forge init)")
    .addHelpText("after", "\n  Equivalent to: forge init\n")
    .action(async () => {
      const { spawnSync } = await import("child_process");
      const result = spawnSync(process.argv[0], [process.argv[1], "init"], {
        stdio: "inherit",
        env: process.env,
      });
      process.exit(result.status ?? 0);
    });
}

// forge plan — intake → architect, structured mode
export function planCommand(): Command {
  return new Command("plan")
    .description("Plan a feature: intake → architect (structured pipeline)")
    .argument("<title>", "What to plan")
    .option("--description <desc>", "Additional context for the planner")
    .addHelpText(
      "after",
      `
Examples:
  forge plan "user authentication system"
  forge plan "redesign checkout flow" --description "focus on mobile UX"
`,
    )
    .action(async (title: string, opts: { description?: string }) => {
      try {
        const result = await api<IntakeResult>("/v1/intake/requests", "POST", {
          source: "cli",
          type: "feature",
          title,
          description: opts.description,
          executionMode: "structured",
          requestedBy: "cli",
        });
        printResult("Plan created.", result);
      } catch (err: any) {
        console.error(`\x1b[31mError: ${err.message}\x1b[0m`);
        process.exit(1);
      }
    });
}

// forge work — pipeline with mode selection; --all forces fast mode, no prompts
export function workCommand(): Command {
  return new Command("work")
    .description("Implement a task (prompts for mode; --all forces fast end-to-end)")
    .argument("<title>", "What to implement")
    .option("--description <desc>", "Additional context")
    .option("--all", "Force fast mode, skip mode prompt, run end-to-end without approval gates")
    .addHelpText(
      "after",
      `
Examples:
  forge work "add dark mode toggle"               # prompts for fast/structured
  forge work "migrate users table" --all          # fast mode, no prompt, no gates
  forge work "redesign checkout" --all --description "mobile first"
`,
    )
    .action(async (title: string, opts: { description?: string; all?: boolean }) => {
      try {
        let mode: ExecutionMode;
        let modeSource: "flag" | "prompt" | "default";

        if (opts.all) {
          // --all: bypass mode prompt, force fast pipeline end-to-end
          mode = "fast";
          modeSource = "flag";
        } else {
          // No --all: prompt user for fast vs structured (same UX as forge feature create)
          const selection = await resolveExecutionMode(undefined);
          mode = selection.mode;
          modeSource = selection.source;
        }

        const result = await api<IntakeResult>("/v1/intake/requests", "POST", {
          source: "cli",
          type: "feature",
          title,
          description: opts.description,
          executionMode: mode,
          requestedBy: "cli",
        });

        const modeNote = modeSource === "default" ? " (defaulted)" : "";
        console.log(`\n  Mode: ${describeExecutionMode(mode)}${modeNote}`);
        printResult("Work started.", result);
      } catch (err: any) {
        console.error(`\x1b[31mError: ${err.message}\x1b[0m`);
        process.exit(1);
      }
    });
}

// forge review — 4-perspective code review via refactor pipeline
export function reviewCommand(): Command {
  return new Command("review")
    .description("Review code: security, performance, quality, accessibility")
    .argument("<scope>", "Area, file path, or feature to review")
    .option("--description <desc>", "Additional review instructions")
    .addHelpText(
      "after",
      `
Examples:
  forge review "src/auth module"
  forge review "payment flow" --description "focus on PCI compliance"
`,
    )
    .action(async (scope: string, opts: { description?: string }) => {
      try {
        const reviewDescription = [
          "Conduct a 4-perspective code review covering:",
          "1. Security — injection, XSS, credential exposure, auth bypasses",
          "2. Performance — N+1 queries, memory leaks, unnecessary re-renders",
          "3. Quality — naming clarity, SRP, dead code, test coverage gaps",
          "4. Accessibility — ARIA labels, keyboard navigation, color contrast",
          opts.description ? `\nAdditional instructions: ${opts.description}` : "",
        ]
          .filter(Boolean)
          .join("\n");

        const result = await api<IntakeResult>("/v1/intake/requests", "POST", {
          source: "cli",
          type: "refactor",
          title: `Review: ${scope}`,
          description: reviewDescription,
          executionMode: "fast",
          requestedBy: "cli",
        });
        printResult("Review started.", result);
      } catch (err: any) {
        console.error(`\x1b[31mError: ${err.message}\x1b[0m`);
        process.exit(1);
      }
    });
}

// forge release — CHANGELOG, version tag, deployment readiness
export function releaseCommand(): Command {
  return new Command("release")
    .description("Cut a release: CHANGELOG, version bump, deployment readiness check")
    .argument("<version>", "Version tag (e.g. v1.2.0)")
    .option("--description <desc>", "Release scope or notes")
    .addHelpText(
      "after",
      `
Examples:
  forge release v1.2.0
  forge release v2.0.0 --description "breaking: new auth flow, drops Node 16"
`,
    )
    .action(async (version: string, opts: { description?: string }) => {
      try {
        const result = await api<IntakeResult>("/v1/intake/requests", "POST", {
          source: "cli",
          type: "release",
          title: `Release ${version}`,
          description: opts.description,
          executionMode: "fast",
          requestedBy: "cli",
        });
        printResult(`Release ${version} pipeline started.`, result);
      } catch (err: any) {
        console.error(`\x1b[31mError: ${err.message}\x1b[0m`);
        process.exit(1);
      }
    });
}
