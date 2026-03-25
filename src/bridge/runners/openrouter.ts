import { createChildLogger } from "../../utils/logger.js";
import type { AgentRunner, AgentRunnerConfig, AgentResult } from "./types.js";

const log = createChildLogger("openrouter");

export class OpenRouterRunner implements AgentRunner {
  async run(config: AgentRunnerConfig): Promise<AgentResult> {
    const apiKey = config.env?.OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return {
        success: false,
        error: "OPENROUTER_API_KEY not configured",
        durationMs: 0,
        provider: "openrouter",
      };
    }

    const startTime = Date.now();
    log.info({ agent: config.agentSlug, model: config.model }, "Calling OpenRouter");

    try {
      const messages: Array<{ role: string; content: string }> = [];

      if (config.systemPrompt) {
        messages.push({ role: "system", content: config.systemPrompt });
      }
      messages.push({ role: "user", content: config.input });

      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "HTTP-Referer": "https://forge.dev",
          "X-Title": "Forge v3",
        },
        body: JSON.stringify({
          model: config.model,
          messages,
        }),
      });

      const durationMs = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        log.error({ agent: config.agentSlug, status: response.status }, "OpenRouter API error");
        return {
          success: false,
          error: `OpenRouter API error (${response.status}): ${errorText}`,
          durationMs,
          provider: "openrouter",
        };
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };

      const output = data.choices?.[0]?.message?.content || "";

      log.info({ agent: config.agentSlug, chars: output.length, durationMs }, "OpenRouter completed");

      return {
        success: true,
        output,
        tokenUsage: {
          input: data.usage?.prompt_tokens || 0,
          output: data.usage?.completion_tokens || 0,
        },
        durationMs,
        provider: "openrouter",
      };
    } catch (err) {
      return {
        success: false,
        error: `OpenRouter error: ${err instanceof Error ? err.message : String(err)}`,
        durationMs: Date.now() - startTime,
        provider: "openrouter",
      };
    }
  }
}
