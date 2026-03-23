import { spawn } from "child_process";
import { collectStream } from "../../utils/stream.js";
import { loadConfig } from "../../utils/config.js";
import { createChildLogger } from "../../utils/logger.js";
import type { AgentRunner, AgentRunnerConfig, AgentResult } from "./types.js";

const log = createChildLogger("claude-cli");

const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes
const UUID_SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuidSessionId(sessionId: string): boolean {
  return UUID_SESSION_ID_PATTERN.test(sessionId);
}

function resolveAllowedTools(permissions: Record<string, boolean>): string {
  const toolMap: Record<string, string[]> = {
    read: ["Read"],
    edit: ["Edit"],
    write: ["Write"],
    bash: ["Bash"],
    grep: ["Grep"],
    glob: ["Glob"],
  };

  const tools: string[] = [];
  for (const [perm, toolNames] of Object.entries(toolMap)) {
    if (permissions[perm]) {
      tools.push(...toolNames);
    }
  }

  // Always allow Read and Grep for agents that need to understand code
  if (!tools.includes("Read")) tools.push("Read");
  if (!tools.includes("Grep")) tools.push("Grep");
  if (!tools.includes("Glob")) tools.push("Glob");

  return tools.join(",");
}

export class ClaudeCliRunner implements AgentRunner {
  async run(config: AgentRunnerConfig): Promise<AgentResult> {
    const firmConfig = loadConfig();
    const claudePath = firmConfig.claudePath;
    const timeoutMs = config.timeoutMs || DEFAULT_TIMEOUT_MS;
    const startTime = Date.now();

    log.info({ agent: config.agentSlug, cwd: config.projectPath }, "Spawning Claude CLI");

    return new Promise((resolve) => {
      try {
        const args = [
          "-p",
          "--verbose",
          "--output-format", "stream-json",
          "--model", config.model,
        ];

        if (config.systemPrompt) {
          args.push("--system-prompt", config.systemPrompt);
        }

        const resumableSessionId =
          config.sessionId && isUuidSessionId(config.sessionId) ? config.sessionId : undefined;

        if (config.sessionId && !resumableSessionId) {
          log.warn(
            { agent: config.agentSlug, sessionId: config.sessionId },
            "Skipping Claude CLI resume because session ID is not a valid UUID",
          );
        }

        if (resumableSessionId) {
          args.push("-r", resumableSessionId);
        }

        const allowedTools = resolveAllowedTools(config.permissions);
        if (allowedTools) {
          args.push("--allowedTools", allowedTools);
        }

        const proc = spawn(claudePath, args, {
          cwd: config.projectPath,
          env: { ...process.env, ...config.env },
        });

        proc.stdin!.write(config.input);
        proc.stdin!.end();

        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          proc.kill("SIGTERM");
          log.warn({ agent: config.agentSlug }, `CLI timed out after ${timeoutMs / 1000}s`);
        }, timeoutMs);

        Promise.all([
          collectStream(proc.stdout!, config.onStream),
          collectStream(proc.stderr!, config.onStream ? (c) => config.onStream!(`\x1b[31m${c}\x1b[0m`) : undefined),
        ]).then(([stdout, stderr]) => {
          return new Promise<void>((res) => proc.on("close", () => res())).then(() => {
            clearTimeout(timer);
            const durationMs = Date.now() - startTime;

            if (timedOut) {
              resolve({
                success: false,
                error: `Claude CLI timed out after ${timeoutMs / 1000}s`,
                durationMs,
                provider: "claude-cli",
              });
              return;
            }

            if (proc.exitCode !== 0) {
              log.error({ agent: config.agentSlug, exitCode: proc.exitCode, stderr: stderr.slice(0, 300) }, "CLI failed");
              resolve({
                success: false,
                error: `CLI exited with code ${proc.exitCode}. stderr: ${stderr.slice(0, 500)}`,
                durationMs,
                provider: "claude-cli",
              });
              return;
            }

            // Parse Claude CLI stream-json envelope (one JSON object per line)
            try {
              let resultEnvelope: Record<string, unknown> | null = null;
              for (const line of stdout.split("\n")) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                try {
                  const parsed = JSON.parse(trimmed) as Record<string, unknown>;
                  if (parsed.type === "result") {
                    resultEnvelope = parsed;
                  }
                } catch {
                  // skip non-JSON lines
                }
              }

              const output = resultEnvelope
                ? (typeof resultEnvelope.result === "string" ? resultEnvelope.result : stdout)
                : stdout;

              const usage = resultEnvelope?.usage as Record<string, number> | undefined;

              log.info({ agent: config.agentSlug, chars: output.length, durationMs }, "CLI completed");

              resolve({
                success: true,
                output,
                tokenUsage: {
                  input: usage?.input_tokens || (resultEnvelope?.input_tokens as number) || 0,
                  output: usage?.output_tokens || (resultEnvelope?.output_tokens as number) || 0,
                },
                durationMs,
                provider: "claude-cli",
              });
            } catch {
              resolve({
                success: true,
                output: stdout,
                durationMs,
                provider: "claude-cli",
              });
            }
          });
        }).catch((err) => {
          clearTimeout(timer);
          resolve({
            success: false,
            error: `Stream error: ${err instanceof Error ? err.message : String(err)}`,
            durationMs: Date.now() - startTime,
            provider: "claude-cli",
          });
        });
      } catch (err) {
        resolve({
          success: false,
          error: `Spawn failed: ${err instanceof Error ? err.message : String(err)}`,
          durationMs: Date.now() - startTime,
          provider: "claude-cli",
        });
      }
    });
  }
}
