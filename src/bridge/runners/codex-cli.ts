import { spawn } from "child_process";
import { collectStream } from "../../utils/stream.js";
import { createChildLogger } from "../../utils/logger.js";
import type { AgentRunner, AgentRunnerConfig, AgentResult } from "./types.js";

const log = createChildLogger("codex-cli");
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export class CodexCliRunner implements AgentRunner {
  async run(config: AgentRunnerConfig): Promise<AgentResult> {
    const timeoutMs = config.timeoutMs || DEFAULT_TIMEOUT_MS;
    const startTime = Date.now();

    log.info({ agent: config.agentSlug, cwd: config.projectPath }, "Spawning Codex CLI");

    return new Promise((resolve) => {
      try {
        const args = [
          "exec",
          "--skip-git-repo-check",
          ...(config.model ? ["--model", config.model] : []),
          "--full-auto",
          config.input,
        ];
        
        const proc = spawn("codex", args, {
          cwd: config.projectPath,
          env: { ...process.env, ...config.env },
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
                error: `Codex CLI timed out`,
                durationMs,
                provider: "codex-cli",
              });
              return;
            }

            if (proc.exitCode !== 0) {
              resolve({
                success: false,
                error: `CLI exited ${proc.exitCode}. stderr: ${stderr.slice(0, 500)}`,
                durationMs,
                provider: "codex-cli",
              });
              return;
            }

            resolve({
              success: true,
              output: stdout,
              durationMs,
              provider: "codex-cli",
              tokenUsage: { input: Math.ceil(config.input.length / 4), output: Math.ceil(stdout.length / 4) }
            });
          });
        }).catch((err) => {
          clearTimeout(timer);
          resolve({
            success: false,
            error: `Stream error: ${err instanceof Error ? err.message : String(err)}`,
            durationMs: Date.now() - startTime,
            provider: "codex-cli",
          });
        });
      } catch (err) {
        resolve({
          success: false,
          error: `Spawn failed: ${err instanceof Error ? err.message : String(err)}`,
          durationMs: Date.now() - startTime,
          provider: "codex-cli",
        });
      }
    });
  }
}
