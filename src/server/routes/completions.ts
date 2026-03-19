import type { FastifyInstance } from "fastify";
import { ClaudeCliRunner } from "../../bridge/runners/claude-cli.js";
import { loadConfig } from "../../utils/config.js";
import { createChildLogger } from "../../utils/logger.js";

const log = createChildLogger("completions");

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface CompletionRequest {
  model?: string;
  messages?: ChatMessage[];
  stream?: boolean;
}

const AGENT_TIMEOUT_MS = 900_000; // 15 minutes

export async function completionsRoutes(server: FastifyInstance) {
  /** OpenAI-compatible chat completions endpoint. Ported from v1 web/server.ts. */
  server.post<{ Body: CompletionRequest }>("/v1/chat/completions", async (request, reply) => {
    log.info("POST /v1/chat/completions");

    const { model, messages = [], stream } = request.body;

    const systemMsg = messages.find((m) => m.role === "system");
    const systemPrompt = systemMsg?.content ?? "";
    const nonSystemMessages = messages.filter((m) => m.role !== "system");

    if (nonSystemMessages.length === 0) {
      return reply.code(400).send({ error: "No user messages provided" });
    }

    // Build conversation text for Claude CLI stdin
    const turns = nonSystemMessages
      .map((m) => `${m.role === "user" ? "Human" : "Assistant"}: ${m.content}`)
      .join("\n\n");

    const config = loadConfig();
    const cliModel = model === "claude-cli-sonnet" ? "sonnet" : (model || "sonnet");

    const runner = new ClaudeCliRunner();
    const result = await runner.run({
      projectPath: config.projectPath,
      agentSlug: "chat",
      model: cliModel,
      systemPrompt,
      input: turns,
      permissions: { read: true, grep: true, glob: true },
      timeoutMs: AGENT_TIMEOUT_MS,
    });

    if (!result.success) {
      return reply.code(500).send({ error: result.error });
    }

    const id = `chatcmpl-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);
    const responseModel = model ?? "claude-cli";

    if (stream) {
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      const sendChunk = (delta: Record<string, unknown>, finishReason: string | null = null) => {
        const chunk = JSON.stringify({
          id, object: "chat.completion.chunk", created, model: responseModel,
          choices: [{ index: 0, delta, finish_reason: finishReason }],
        });
        reply.raw.write(`data: ${chunk}\n\n`);
      };

      sendChunk({ role: "assistant", content: "" });
      sendChunk({ content: result.output });
      sendChunk({}, "stop");
      reply.raw.write("data: [DONE]\n\n");
      reply.raw.end();
    } else {
      return {
        id, object: "chat.completion", created, model: responseModel,
        choices: [{
          index: 0,
          message: { role: "assistant", content: result.output },
          finish_reason: "stop",
        }],
        usage: {
          prompt_tokens: result.tokenUsage?.input || 0,
          completion_tokens: result.tokenUsage?.output || 0,
          total_tokens: (result.tokenUsage?.input || 0) + (result.tokenUsage?.output || 0),
        },
      };
    }
  });
}
