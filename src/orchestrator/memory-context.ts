import { existsSync, readFileSync } from "fs";
import { join } from "path";

// Agents that benefit from project memory context.
// intake-gate just normalises requests — memory would add noise.
// retrospective-analyst writes context.md — it doesn't need to read it.
const MEMORY_AWARE_AGENTS = new Set([
  "architect",
  "builder",
  "quality-guard",
  "devops",
  "planner",
  "harness-builder",
  "evaluator",
]);

// Hard cap: ~500 tokens. Keeps injection cost predictable regardless of
// how much retrospective-analyst writes.
const MAX_CHARS = 2000;

const CONTEXT_PLACEHOLDER = "_No context yet";

/**
 * Returns the compressed project memory context for injection into a pipeline
 * step's input, or an empty string when not applicable.
 *
 * Reads `.forge/memory/context.md` from the project root. That file is
 * maintained (rewritten) by retrospective-analyst after every pipeline run —
 * it is the compressed operational snapshot of append-only history files.
 */
export function readMemoryContext(projectPath: string, agentSlug: string): string {
  if (!MEMORY_AWARE_AGENTS.has(agentSlug)) return "";

  const contextPath = join(projectPath, ".forge", "memory", "context.md");
  if (!existsSync(contextPath)) return "";

  const raw = readFileSync(contextPath, "utf-8").trim();
  if (!raw || raw.includes(CONTEXT_PLACEHOLDER)) return "";

  const content = raw.length > MAX_CHARS ? `${raw.slice(0, MAX_CHARS)}\n...(truncated)` : raw;
  return `## Project Memory Context\n\n${content}`;
}
