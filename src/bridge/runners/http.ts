import { createChildLogger } from "../../utils/logger.js";
import type { AgentRunner, AgentRunnerConfig, AgentResult } from "./types.js";

const log = createChildLogger("http-runner");
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export class HttpRunner implements AgentRunner {
  async run(config: AgentRunnerConfig): Promise<AgentResult> {
    const startTime = Date.now();
    const url = config.adapterConfig?.url;

    if (!url) {
      return {
        success: false,
        error: "adapterConfig.url is required for http runner",
        durationMs: 0,
        provider: "http",
      };
    }

    log.info({ agent: config.agentSlug, url }, "Making HTTP request");

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
          input: config.input,
          systemPrompt: config.systemPrompt,
          model: config.model,
          projectPath: config.projectPath,
          agentSlug: config.agentSlug,
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);
      const durationMs = Date.now() - startTime;

      if (!res.ok) {
        const errText = await res.text().catch(() => "Unknown error");
        return {
          success: false,
          error: `HTTP ${res.status}: ${errText.slice(0, 500)}`,
          durationMs,
          provider: "http",
        };
      }

      const contentType = res.headers.get("content-type") || "";
      let output = "";
      let tokenUsage;

      if (contentType.includes("application/json")) {
        const body = await res.json() as any;
        output = body.output || JSON.stringify(body);
        tokenUsage = body.tokenUsage;
      } else {
        output = await res.text();
      }

      if (config.onStream) {
        config.onStream(output);
      }

      return {
        success: true,
        output,
        tokenUsage: tokenUsage || {
          input: Math.ceil(config.input.length / 4),
          output: Math.ceil(output.length / 4)
        },
        durationMs,
        provider: "http",
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.name === "AbortError" ? "HTTP request timed out" : `HTTP request failed: ${err.message}`,
        durationMs: Date.now() - startTime,
        provider: "http",
      };
    }
  }
}
