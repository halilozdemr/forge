import { createChildLogger } from "../../utils/logger.js";
import type { AgentRunner, AgentRunnerConfig, AgentResult } from "./types.js";

const log = createChildLogger("gemini-api");
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export class GeminiApiRunner implements AgentRunner {
  async run(config: AgentRunnerConfig): Promise<AgentResult> {
    const apiKey =
      (config.env?.GOOGLE_AI_API_KEY) ||
      process.env.GOOGLE_AI_API_KEY;

    if (!apiKey) {
      return {
        success: false,
        error: "GOOGLE_AI_API_KEY not configured",
        durationMs: 0,
        provider: "gemini-api",
      };
    }

    const startTime = Date.now();
    const modelId = config.model; // e.g. "gemini-2.5-pro"
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;

    log.info({ agent: config.agentSlug, model: modelId }, "Calling Gemini API");

    try {
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        config.timeoutMs ?? DEFAULT_TIMEOUT_MS
      );

      const requestBody: Record<string, unknown> = {
        contents: [
          { role: "user", parts: [{ text: config.input }] },
        ],
        generationConfig: {
          maxOutputTokens: 8192,
        },
      };

      if (config.systemPrompt) {
        requestBody.systemInstruction = {
          parts: [{ text: config.systemPrompt }],
        };
      }

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timer);
      const durationMs = Date.now() - startTime;

      if (!response.ok) {
        const errText = await response.text();
        log.error({ agent: config.agentSlug, status: response.status }, "Gemini API error");
        return {
          success: false,
          error: `Gemini API error (${response.status}): ${errText.slice(0, 500)}`,
          durationMs,
          provider: "gemini-api",
        };
      }

      const data = (await response.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
        }>;
        usageMetadata?: {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
        };
      };

      const output =
        data.candidates?.[0]?.content?.parts
          ?.map((p) => p.text ?? "")
          .join("") ?? "";

      if (config.onStream) config.onStream(output);

      log.info({ agent: config.agentSlug, chars: output.length, durationMs }, "Gemini API completed");

      return {
        success: true,
        output,
        tokenUsage: {
          input:  data.usageMetadata?.promptTokenCount     ?? 0,
          output: data.usageMetadata?.candidatesTokenCount ?? 0,
        },
        durationMs,
        provider: "gemini-api",
      };
    } catch (err: unknown) {
      const isAbort = err instanceof Error && err.name === "AbortError";
      return {
        success: false,
        error: isAbort
          ? "Gemini API request timed out"
          : `Gemini API error: ${err instanceof Error ? err.message : String(err)}`,
        durationMs: Date.now() - startTime,
        provider: "gemini-api",
      };
    }
  }
}
