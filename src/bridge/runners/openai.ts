import { createChildLogger } from "../../utils/logger.js";
import type { AgentRunner, AgentRunnerConfig, AgentResult } from "./types.js";

const log = createChildLogger("openai");

/**
 * OpenAI Chat Completions runner. Uses the same request/response schema as the
 * OpenRouter runner, and honours OPENAI_BASE_URL so OpenAI-compatible gateways
 * (Azure OpenAI proxies, local shims) can be targeted too.
 */
export class OpenAIRunner implements AgentRunner {
  async run(config: AgentRunnerConfig): Promise<AgentResult> {
    const apiKey = config.env?.OPENAI_API_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return {
        success: false,
        error: "OPENAI_API_KEY not configured",
        durationMs: 0,
        provider: "openai",
      };
    }

    const baseUrl = (
      config.env?.OPENAI_BASE_URL ||
      process.env.OPENAI_BASE_URL ||
      "https://api.openai.com/v1"
    ).replace(/\/$/, "");

    const startTime = Date.now();
    log.info({ agent: config.agentSlug, model: config.model }, "Calling OpenAI");

    try {
      const messages: Array<{ role: string; content: string }> = [];

      if (config.systemPrompt) {
        messages.push({ role: "system", content: config.systemPrompt });
      }
      messages.push({ role: "user", content: config.input });

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages,
        }),
      });

      const durationMs = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        log.error({ agent: config.agentSlug, status: response.status }, "OpenAI API error");
        return {
          success: false,
          error: `OpenAI API error (${response.status}): ${errorText}`,
          durationMs,
          provider: "openai",
        };
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };

      const output = data.choices?.[0]?.message?.content || "";

      log.info({ agent: config.agentSlug, chars: output.length, durationMs }, "OpenAI completed");

      return {
        success: true,
        output,
        tokenUsage: {
          input: data.usage?.prompt_tokens || 0,
          output: data.usage?.completion_tokens || 0,
        },
        durationMs,
        provider: "openai",
      };
    } catch (err) {
      return {
        success: false,
        error: `OpenAI error: ${err instanceof Error ? err.message : String(err)}`,
        durationMs: Date.now() - startTime,
        provider: "openai",
      };
    }
  }
}
