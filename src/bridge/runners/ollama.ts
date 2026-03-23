import { createChildLogger } from "../../utils/logger.js";
import type { AgentRunner, AgentRunnerConfig, AgentResult } from "./types.js";

const log = createChildLogger("ollama");
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // 10 min — local models may need time to load
const DEFAULT_BASE_URL = "http://localhost:11434";

export class OllamaRunner implements AgentRunner {
  async run(config: AgentRunnerConfig): Promise<AgentResult> {
    const startTime = Date.now();
    const baseUrl =
      (config.adapterConfig?.ollamaBaseUrl as string | undefined) ||
      process.env.OLLAMA_BASE_URL ||
      DEFAULT_BASE_URL;

    log.info({ agent: config.agentSlug, model: config.model, baseUrl }, "Calling Ollama");

    try {
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        config.timeoutMs ?? DEFAULT_TIMEOUT_MS
      );

      const messages: Array<{ role: string; content: string }> = [];
      if (config.systemPrompt) {
        messages.push({ role: "system", content: config.systemPrompt });
      }
      messages.push({ role: "user", content: config.input });

      const response = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: config.model,
          messages,
          stream: false,
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);
      const durationMs = Date.now() - startTime;

      if (!response.ok) {
        const errText = await response.text();
        log.error({ agent: config.agentSlug, status: response.status }, "Ollama error");
        return {
          success: false,
          error: `Ollama error (${response.status}): ${errText.slice(0, 500)}`,
          durationMs,
          provider: "ollama",
        };
      }

      const data = (await response.json()) as {
        message?: { content?: string };
        prompt_eval_count?: number;
        eval_count?: number;
      };

      const output = data.message?.content ?? "";

      if (config.onStream) config.onStream(output);

      log.info({ agent: config.agentSlug, chars: output.length, durationMs }, "Ollama completed");

      return {
        success: true,
        output,
        tokenUsage: {
          input:  data.prompt_eval_count ?? Math.ceil(config.input.length / 4),
          output: data.eval_count        ?? Math.ceil(output.length / 4),
        },
        durationMs,
        provider: "ollama",
      };
    } catch (err: unknown) {
      const isAbort = err instanceof Error && err.name === "AbortError";
      return {
        success: false,
        error: isAbort
          ? "Ollama request timed out"
          : `Ollama error: ${err instanceof Error ? err.message : String(err)}`,
        durationMs: Date.now() - startTime,
        provider: "ollama",
      };
    }
  }
}
