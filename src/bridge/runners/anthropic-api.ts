import { createChildLogger } from "../../utils/logger.js";
import type { AgentRunner, AgentRunnerConfig, AgentResult } from "./types.js";

const log = createChildLogger("anthropic-api");

export class AnthropicApiRunner implements AgentRunner {
  async run(config: AgentRunnerConfig): Promise<AgentResult> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return {
        success: false,
        error: "ANTHROPIC_API_KEY not configured",
        durationMs: 0,
        provider: "anthropic-api",
      };
    }

    const startTime = Date.now();
    log.info({ agent: config.agentSlug, model: config.model }, "Calling Anthropic API");

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: config.model,
          max_tokens: 8192,
          system: config.systemPrompt || undefined,
          messages: [{ role: "user", content: config.input }],
        }),
      });

      const durationMs = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        log.error({ agent: config.agentSlug, status: response.status }, "Anthropic API error");
        return {
          success: false,
          error: `Anthropic API error (${response.status}): ${errorText}`,
          durationMs,
          provider: "anthropic-api",
        };
      }

      const data = (await response.json()) as {
        content?: Array<{ type: string; text?: string }>;
        usage?: { input_tokens?: number; output_tokens?: number };
      };

      const output = data.content?.filter((b) => b.type === "text").map((b) => b.text).join("") || "";

      log.info({ agent: config.agentSlug, chars: output.length, durationMs }, "Anthropic API completed");

      return {
        success: true,
        output,
        tokenUsage: {
          input: data.usage?.input_tokens || 0,
          output: data.usage?.output_tokens || 0,
        },
        durationMs,
        provider: "anthropic-api",
      };
    } catch (err) {
      return {
        success: false,
        error: `Anthropic API error: ${err instanceof Error ? err.message : String(err)}`,
        durationMs: Date.now() - startTime,
        provider: "anthropic-api",
      };
    }
  }
}
