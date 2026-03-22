import { spawn } from "child_process";
import { collectStream } from "../../utils/stream.js";
import { createChildLogger } from "../../utils/logger.js";
import type { AgentRunner, AgentRunnerConfig, AgentResult } from "./types.js";

const log = createChildLogger("opencode-cli");
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export class OpenCodeCliRunner implements AgentRunner {
  async run(config: AgentRunnerConfig): Promise<AgentResult> {
    const timeoutMs = config.timeoutMs || DEFAULT_TIMEOUT_MS;
    const startTime = Date.now();

    log.info({ agent: config.agentSlug, cwd: config.projectPath }, "Spawning OpenCode CLI");

    return new Promise((resolve) => {
      try {
        const args = ["run", "--print", config.input];

        const proc = spawn("opencode", args, {
          cwd: config.projectPath,
          env: process.env,
        });

        proc.stdin!.end();

        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          proc.kill("SIGTERM");
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
                error: `OpenCode CLI timed out`,
                durationMs,
                provider: "opencode-cli",
              });
              return;
            }

            if (proc.exitCode !== 0) {
              resolve({
                success: false,
                error: `CLI exited ${proc.exitCode}. stderr: ${stderr.slice(0, 500)}`,
                durationMs,
                provider: "opencode-cli",
              });
              return;
            }

            resolve({
              success: true,
              output: stdout,
              durationMs,
              provider: "opencode-cli",
              tokenUsage: { input: Math.ceil(config.input.length / 4), output: Math.ceil(stdout.length / 4) }
            });
          });
        }).catch((err) => {
          clearTimeout(timer);
          resolve({
            success: false,
            error: `Stream error: ${err instanceof Error ? err.message : String(err)}`,
            durationMs: Date.now() - startTime,
            provider: "opencode-cli",
          });
        });
      } catch (err) {
        resolve({
          success: false,
          error: `Spawn failed: ${err instanceof Error ? err.message : String(err)}`,
          durationMs: Date.now() - startTime,
          provider: "opencode-cli",
        });
      }
    });
  }
}
