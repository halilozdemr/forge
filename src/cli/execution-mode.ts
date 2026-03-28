import { Option } from "commander";
import { select } from "./prompts.js";

export type ExecutionMode = "fast" | "structured";
type ModeSource = "flag" | "prompt" | "default";

export function createExecutionModeOption(): Option {
  return new Option(
    "--mode <mode>",
    "Execution mode: fast (simple tasks, quick iteration) or structured (planning, checkpoints, approvals for larger work)",
  ).choices(["fast", "structured"]);
}

export function describeExecutionMode(mode: ExecutionMode): string {
  return mode === "structured"
    ? "Structured — planning, checkpoints, approvals for larger work"
    : "Fast — simple tasks, quick iteration";
}

export async function resolveExecutionMode(mode?: string): Promise<{ mode: ExecutionMode; source: ModeSource }> {
  if (mode === "fast" || mode === "structured") {
    return { mode, source: "flag" };
  }

  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  if (interactive) {
    const selectedMode = await select<ExecutionMode>({
      message: "Execution mode:",
      options: [
        { value: "fast", label: "Fast", hint: "Simple tasks, quick iteration" },
        { value: "structured", label: "Structured", hint: "Planning, checkpoints, approvals for larger work" },
      ],
    });
    return { mode: selectedMode, source: "prompt" };
  }

  return { mode: "fast", source: "default" };
}
