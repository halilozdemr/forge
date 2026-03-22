import { createChildLogger } from "../../utils/logger.js";
import type { AgentRunner, AgentRunnerConfig, AgentResult } from "./types.js";

const log = createChildLogger("cursor-runner");
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

export class CursorRunner implements AgentRunner {
  async run(config: AgentRunnerConfig): Promise<AgentResult> {
    const startTime = Date.now();
    // Default to localhost:11000 or whatever adapterConfig specifies
    const url = config.adapterConfig?.url || "http://localhost:11000/cursor/agent";

    log.info({ agent: config.agentSlug, url }, "Making Cursor API request");

    try {
      const controller = new AbortController();
      const timeoutMs = config.timeoutMs || DEFAULT_TIMEOUT_MS;
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(config.adapterConfig?.headers || {})
        },
        body: JSON.stringify({
          prompt: config.input,
          context: {
            systemPrompt: config.systemPrompt,
            projectPath: config.projectPath,
            agentSlug: config.agentSlug,
            model: config.model,
            env: config.env,
          }
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);
      const durationMs = Date.now() - startTime;

      if (!res.ok) {
        const errText = await res.text().catch(() => "Unknown error");
        return {
          success: false,
          error: `Cursor API HTTP ${res.status}: ${errText.slice(0, 500)}`,
          durationMs,
          provider: "cursor",
        };
      }

      const body = await res.json() as any;
      const output = body.response || body.output || JSON.stringify(body);

      if (config.onStream) {
        config.onStream(output);
      }

      return {
        success: true,
        output,
        tokenUsage: body.tokenUsage || {
          input: Math.ceil(config.input.length / 4),
          output: Math.ceil(output.length / 4)
        },
        durationMs,
        provider: "cursor",
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.name === "AbortError" ? "Cursor API request timed out" : `Cursor API request failed: ${err.message}`,
        durationMs: Date.now() - startTime,
        provider: "cursor",
      };
    }
  }
}
