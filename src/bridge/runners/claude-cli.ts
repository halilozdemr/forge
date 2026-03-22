import { spawn } from "child_process";
import { collectStream } from "../../utils/stream.js";
import { loadConfig } from "../../utils/config.js";
import { createChildLogger } from "../../utils/logger.js";
import type { AgentRunner, AgentRunnerConfig, AgentResult } from "./types.js";

const log = createChildLogger("claude-cli");

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

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
          "--output-format", "json",
          "--model", config.model,
        ];

        if (config.systemPrompt) {
          args.push("--system-prompt", config.systemPrompt);
        }

        const allowedTools = resolveAllowedTools(config.permissions);
        if (allowedTools) {
          args.push("--allowedTools", allowedTools);
        }

        const proc = spawn(claudePath, args, {
          cwd: config.projectPath,
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

            // Parse Claude CLI JSON envelope
            try {
              const envelope = JSON.parse(stdout) as Record<string, unknown>;
              const output = typeof envelope?.result === "string" ? envelope.result : stdout;

              log.info({ agent: config.agentSlug, chars: output.length, durationMs }, "CLI completed");

              resolve({
                success: true,
                output,
                tokenUsage: {
                  input: (envelope?.input_tokens as number) || 0,
                  output: (envelope?.output_tokens as number) || 0,
                },
                durationMs,
                provider: "claude-cli",
              });
            } catch {
              // Not JSON — return raw stdout
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
