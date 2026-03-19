import type { FastifyInstance } from "fastify";
import { ClaudeCliRunner } from "../../bridge/runners/claude-cli.js";
import { loadConfig } from "../../utils/config.js";
import { createChildLogger } from "../../utils/logger.js";

const log = createChildLogger("bridge");

const BRIDGE_TIMEOUT_MS = 120_000; // 2 minutes

interface BridgeRequest {
  projectPath: string;
  taskId: string;
  filePaths: string[];
  context?: string;
}

interface DebugRequest {
  projectPath: string;
  taskId: string;
  filePaths: string[];
  bugReport: string;
}

function buildReviewerPrompt(req: BridgeRequest): string {
  const fileList = req.filePaths.map((f) => `- ${f}`).join("\n");
  return `You are performing a code review for task ${req.taskId}.

Read each of the following files using the Read tool:
${fileList}

Apply this checklist (every item must pass):

### Tests
- Unit tests present, happy path and error path covered
- If no tests → REJECTED, reason: "missing tests"

### Code quality
- SOLID principles followed
- No duplicated logic, no speculative code, no magic strings
- Documentation on public functions
- No TODOs (unless marked [OPEN_QUESTION] with explanation)

### Architecture
- No layer violations (domain doesn't import data)
- Dependencies go inward only, no circular dependencies

Respond ONLY with valid JSON matching this exact schema (no markdown, no extra text):
{"decision":"APPROVED","reasons":["..."],"issues":[]}
or
{"decision":"REJECTED","reasons":["..."],"issues":["specific issue at file:line — how to fix"]}`;
}

function buildArchitectPrompt(req: BridgeRequest): string {
  const fileList = req.filePaths.map((f) => `- ${f}`).join("\n");
  const contextSection = req.context
    ? `\n\n## Escalation context (3 rejection reasons)\n${req.context}`
    : "";
  return `You are the Lead Architect performing a deep architecture review for task ${req.taskId}.${contextSection}

Read the following files using Read and Grep tools:
${fileList}

Apply these principles (non-negotiable):

### SOLID
- Single Responsibility, Open/Closed, Liskov, Interface Segregation, Dependency Inversion

### DRY
- No duplicated logic. If written twice, it must be extracted.

### YAGNI
- No speculative abstractions. Only build what's needed today.

### Module boundaries
- No layer violations, no circular dependencies

Respond ONLY with valid JSON matching this exact schema (no markdown, no extra text):
{"decision":"APPROVED","reasons":["..."],"issues":[]}
or
{"decision":"REDESIGN","reasons":["..."],"issues":["specific architectural issue — proposed fix"]}`;
}

function buildDebuggerPrompt(req: DebugRequest): string {
  const fileList = req.filePaths.map((f) => `- ${f}`).join("\n");
  return `You are performing a root cause analysis for bug report: "${req.bugReport}"

Read each of the following files using the Read and Grep tools:
${fileList}

Your task:
1. Find the exact line(s) causing the issue
2. Determine if this is a simple bug or an architectural problem
3. Write a concrete fix plan (minimum required changes only)

Rules:
- If the fix touches more than 3 files → decision is "ARCHITECTURAL"
- If you cannot reproduce or locate the issue → decision is "NO_REPRO"
- Otherwise → decision is "BUG_FOUND"

Respond ONLY with valid JSON matching this exact schema (no markdown, no extra text):
{"decision":"BUG_FOUND","rootCause":"exact explanation","affectedFiles":["file:line"],"fixPlan":"step by step what to change"}
or
{"decision":"ARCHITECTURAL","rootCause":"...","affectedFiles":["..."],"fixPlan":"escalate to architect — [reason]"}
or
{"decision":"NO_REPRO","rootCause":"could not locate the issue","affectedFiles":[],"fixPlan":"need more information: [what is missing]"}`;
}

function validateFilePaths(filePaths: string[]): string[] {
  return filePaths.filter((p) => p.startsWith("/") || p.includes(".."));
}

export async function bridgeRoutes(server: FastifyInstance) {
  const runner = new ClaudeCliRunner();
  const permissions = { read: true, grep: true, glob: true };

  async function executeBridge(prompt: string, projectPath: string, agentSlug: string) {
    const result = await runner.run({
      projectPath,
      agentSlug,
      model: "sonnet",
      systemPrompt: "",
      input: prompt,
      permissions,
      timeoutMs: BRIDGE_TIMEOUT_MS,
    });

    if (!result.success) {
      throw new Error(result.error || "Bridge execution failed");
    }

    // Parse JSON from output
    const match = result.output?.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        throw new Error(`Output not parseable: ${result.output?.slice(0, 300)}`);
      }
    }
    throw new Error(`No JSON found in output: ${result.output?.slice(0, 300)}`);
  }

  // POST /api/review
  server.post<{ Body: BridgeRequest }>("/api/review", async (request, reply) => {
    log.info("POST /api/review");
    const body = request.body;

    if (!body.projectPath || !body.taskId || !Array.isArray(body.filePaths) || body.filePaths.length === 0) {
      return reply.code(400).send({ error: "projectPath, taskId, and filePaths are required" });
    }

    const invalid = validateFilePaths(body.filePaths);
    if (invalid.length > 0) {
      return reply.code(400).send({ error: `Invalid file paths: ${invalid.join(", ")}` });
    }

    try {
      const result = await executeBridge(buildReviewerPrompt(body), body.projectPath, "reviewer");
      return { ...result, provider: "cli" };
    } catch (e) {
      return reply.code(500).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  // POST /api/architect
  server.post<{ Body: BridgeRequest }>("/api/architect", async (request, reply) => {
    log.info("POST /api/architect");
    const body = request.body;

    if (!body.projectPath || !body.taskId || !Array.isArray(body.filePaths) || body.filePaths.length === 0) {
      return reply.code(400).send({ error: "projectPath, taskId, and filePaths are required" });
    }

    const invalid = validateFilePaths(body.filePaths);
    if (invalid.length > 0) {
      return reply.code(400).send({ error: `Invalid file paths: ${invalid.join(", ")}` });
    }

    try {
      const result = await executeBridge(buildArchitectPrompt(body), body.projectPath, "architect");
      return { ...result, provider: "cli" };
    } catch (e) {
      return reply.code(500).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  // POST /api/debug
  server.post<{ Body: DebugRequest }>("/api/debug", async (request, reply) => {
    log.info("POST /api/debug");
    const body = request.body;

    if (!body.projectPath || !body.taskId || !Array.isArray(body.filePaths) || body.filePaths.length === 0 || !body.bugReport) {
      return reply.code(400).send({ error: "projectPath, taskId, filePaths, and bugReport are required" });
    }

    const invalid = validateFilePaths(body.filePaths);
    if (invalid.length > 0) {
      return reply.code(400).send({ error: `Invalid file paths: ${invalid.join(", ")}` });
    }

    try {
      const result = await executeBridge(buildDebuggerPrompt(body), body.projectPath, "debugger");
      return { ...result, provider: "cli" };
    } catch (e) {
      return reply.code(500).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });
}
