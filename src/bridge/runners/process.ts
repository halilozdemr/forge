import { spawn } from "child_process";
import { collectStream } from "../../utils/stream.js";
import { createChildLogger } from "../../utils/logger.js";
import type { AgentRunner, AgentRunnerConfig, AgentResult } from "./types.js";

const log = createChildLogger("process-runner");
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export class ProcessRunner implements AgentRunner {
  async run(config: AgentRunnerConfig): Promise<AgentResult> {
    const timeoutMs = config.timeoutMs || DEFAULT_TIMEOUT_MS;
    const startTime = Date.now();

    const command = config.adapterConfig?.command;
    if (!command) {
      return {
        success: false,
        error: "adapterConfig.command is required for process runner",
        durationMs: 0,
        provider: "process",
      };
    }
    
    const args: string[] = config.adapterConfig?.args || [];

    log.info({ agent: config.agentSlug, command, cwd: config.projectPath }, "Spawning custom process");

    return new Promise((resolve) => {
      try {
        const proc = spawn(command, args, {
          cwd: config.projectPath,
          env: process.env,
        });

        proc.stdin!.write(config.input);
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
                error: `Process timed out`,
                durationMs,
                provider: "process",
              });
              return;
            }

            if (proc.exitCode !== 0) {
              resolve({
                success: false,
                error: `Process exited ${proc.exitCode}. stderr: ${stderr.slice(0, 500)}`,
                durationMs,
                provider: "process",
              });
              return;
            }

            resolve({
              success: true,
              output: stdout,
              durationMs,
              provider: "process",
              tokenUsage: { input: Math.ceil(config.input.length / 4), output: Math.ceil(stdout.length / 4) }
            });
          });
        }).catch((err) => {
          clearTimeout(timer);
          resolve({
            success: false,
            error: `Stream error: ${err instanceof Error ? err.message : String(err)}`,
            durationMs: Date.now() - startTime,
            provider: "process",
          });
        });
      } catch (err) {
        resolve({
          success: false,
          error: `Spawn failed: ${err instanceof Error ? err.message : String(err)}`,
          durationMs: Date.now() - startTime,
          provider: "process",
        });
      }
    });
  }
}
