import type { FastifyInstance } from "fastify";
import { loadConfig } from "../../utils/config.js";
import { createChildLogger } from "../../utils/logger.js";
import { createRunner } from "../../bridge/runners/factory.js";

const log = createChildLogger("completions");

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | Array<{ type?: string; text?: string; [key: string]: unknown }> | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id?: string;
    type?: string;
    function?: {
      name?: string;
      arguments?: string;
    };
  }>;
}

interface CompletionTool {
  type?: string;
  function?: {
    name?: string;
    description?: string;
    parameters?: unknown;
  };
}

interface CompletionToolChoice {
  type?: string;
  function?: {
    name?: string;
  };
}

interface CompletionRequest {
  model?: string;
  messages?: ChatMessage[];
  stream?: boolean;
  tools?: CompletionTool[];
  tool_choice?: "auto" | "none" | CompletionToolChoice;
}

const AGENT_TIMEOUT_MS = 900_000; // 15 minutes
const ANSI_ESCAPE_PATTERN = /\u001b\[[0-9;]*m/g;

function stringifyContent(content: ChatMessage["content"]): string {
  if (typeof content === "string") return content;
  if (content == null) return "";
  return content
    .map((part) => {
      if (typeof part?.text === "string") return part.text;
      return JSON.stringify(part);
    })
    .join("\n");
}

function buildToolInstructions(tools: CompletionTool[], toolChoice?: CompletionRequest["tool_choice"]): string {
  if (!tools.length) return "";

  const renderedTools = tools
    .filter((tool) => tool.type === "function" && tool.function?.name)
    .map((tool) => {
      const fn = tool.function!;
      return [
        `- ${fn.name}`,
        fn.description ? `  Description: ${fn.description}` : "",
        fn.parameters ? `  JSON schema: ${JSON.stringify(fn.parameters)}` : "",
      ].filter(Boolean).join("\n");
    })
    .join("\n");

  const specificTool =
    typeof toolChoice === "object" && toolChoice?.type === "function"
      ? toolChoice.function?.name
      : undefined;

  return [
    "Available tools:",
    renderedTools,
    "",
    "Tool calling protocol:",
    "If you want to call a tool, do not explain your reasoning.",
    "Return ONLY valid JSON using this exact shape:",
    '{"tool_call":{"name":"tool_name","arguments":{}}}',
    specificTool
      ? `You MUST call the tool "${specificTool}" if a tool is needed.`
      : 'If no tool is needed, answer normally as plain text.',
    "Never invent tool names. Arguments must be valid JSON.",
  ].join("\n");
}

function buildConversationTurns(messages: ChatMessage[]): string {
  return messages
    .filter((m) => m.role !== "system")
    .map((m) => {
      if (m.role === "tool") {
        const toolName = m.name || m.tool_call_id || "tool";
        return `Tool (${toolName}) result: ${stringifyContent(m.content)}`;
      }

      if (m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
        const renderedCalls = m.tool_calls
          .map((call) => {
            const fnName = call.function?.name || "tool";
            const args = call.function?.arguments || "{}";
            return `${fnName}(${args})`;
          })
          .join(", ");
        return `Assistant requested tool calls: ${renderedCalls}`;
      }

      return `${m.role === "user" ? "Human" : "Assistant"}: ${stringifyContent(m.content)}`;
    })
    .join("\n\n");
}

function extractToolCall(output: string): { name: string; arguments: string } | null {
  const match = output.match(/\{[\s\S]*\}/);
  if (!match) return null;

  try {
    const parsed = JSON.parse(match[0]) as {
      tool_call?: { name?: string; arguments?: unknown };
      name?: string;
      arguments?: unknown;
    };

    const toolCall = parsed.tool_call ?? parsed;
    if (!toolCall?.name) return null;

    return {
      name: toolCall.name,
      arguments: JSON.stringify(toolCall.arguments ?? {}),
    };
  } catch {
    return null;
  }
}

function sanitizeStreamChunk(chunk: string): string {
  return chunk.replace(ANSI_ESCAPE_PATTERN, "").replace(/\r/g, "");
}

function resolveProviderAndModel(rawModel?: string): { provider: string; model: string } {
  if (!rawModel || rawModel === "claude-cli" || rawModel === "claude-cli-sonnet") {
    return { provider: "claude-cli", model: "sonnet" };
  }

  if (rawModel.startsWith("forge/")) {
    const value = rawModel.slice("forge/".length);
    const separator = value.indexOf("/");
    if (separator > 0) {
      return {
        provider: value.slice(0, separator),
        model: value.slice(separator + 1),
      };
    }
  }

  const separator = rawModel.indexOf("/");
  if (separator > 0) {
    return {
      provider: rawModel.slice(0, separator),
      model: rawModel.slice(separator + 1),
    };
  }

  if (rawModel === "default") {
    return { provider: "opencode-cli", model: rawModel };
  }

  return { provider: "claude-cli", model: rawModel };
}

export async function completionsRoutes(server: FastifyInstance) {
  /** OpenAI-compatible chat completions endpoint. Ported from v1 web/server.ts. */
  server.post<{ Body: CompletionRequest }>("/v1/chat/completions", async (request, reply) => {
    log.info("POST /v1/chat/completions");

    const { model, messages = [], stream, tools = [], tool_choice } = request.body;

    const systemMsg = messages.find((m) => m.role === "system");
    const systemPrompt = systemMsg?.content ?? "";
    const nonSystemMessages = messages.filter((m) => m.role !== "system");

    if (nonSystemMessages.length === 0) {
      return reply.code(400).send({ error: "No user messages provided" });
    }

    const turns = buildConversationTurns(nonSystemMessages);
    const toolInstructions = buildToolInstructions(tools, tool_choice);
    const effectiveSystemPrompt = [systemPrompt, toolInstructions].filter(Boolean).join("\n\n");

    const config = loadConfig();
    const resolved = resolveProviderAndModel(model);
    const runner = createRunner(resolved.provider);
    const id = `chatcmpl-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);
    const responseModel = model ?? "forge/claude-cli/sonnet";

    if (stream) {
      const liveStreamEnabled = tools.length === 0;
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

      let aggregatedOutput = "";
      const result = await runner.run({
        projectPath: config.projectPath,
        agentSlug: "chat",
        model: resolved.model,
        systemPrompt: effectiveSystemPrompt,
        input: turns,
        permissions: { read: true, grep: true, glob: true },
        timeoutMs: AGENT_TIMEOUT_MS,
        onStream: liveStreamEnabled
          ? (chunk) => {
              const sanitized = sanitizeStreamChunk(chunk);
              if (!sanitized) return;
              aggregatedOutput += sanitized;
              sendChunk({ content: sanitized });
            }
          : undefined,
      });

      if (!result.success) {
        sendChunk({ content: `\n[forge error] ${result.error ?? "Unknown error"}` }, "stop");
        reply.raw.write("data: [DONE]\n\n");
        reply.raw.end();
        return;
      }

      if (!liveStreamEnabled) {
        aggregatedOutput = result.output ?? "";
      }

      const toolCall = tools.length > 0 ? extractToolCall(aggregatedOutput || result.output || "") : null;

      if (toolCall) {
        sendChunk({
          tool_calls: [{
            index: 0,
            id: `call_${Date.now()}`,
            type: "function",
            function: {
              name: toolCall.name,
              arguments: toolCall.arguments,
            },
          }],
        }, "tool_calls");
      } else if (!liveStreamEnabled) {
        sendChunk({ content: result.output });
      }

      sendChunk({}, "stop");
      reply.raw.write("data: [DONE]\n\n");
      reply.raw.end();
    } else {
      const result = await runner.run({
        projectPath: config.projectPath,
        agentSlug: "chat",
        model: resolved.model,
        systemPrompt: effectiveSystemPrompt,
        input: turns,
        permissions: { read: true, grep: true, glob: true },
        timeoutMs: AGENT_TIMEOUT_MS,
      });

      if (!result.success) {
        return reply.code(500).send({ error: result.error });
      }

      const toolCall = tools.length > 0 ? extractToolCall(result.output || "") : null;

      if (toolCall) {
        return {
          id, object: "chat.completion", created, model: responseModel,
          choices: [{
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [{
                id: `call_${Date.now()}`,
                type: "function",
                function: {
                  name: toolCall.name,
                  arguments: toolCall.arguments,
                },
              }],
            },
            finish_reason: "tool_calls",
          }],
          usage: {
            prompt_tokens: result.tokenUsage?.input || 0,
            completion_tokens: result.tokenUsage?.output || 0,
            total_tokens: (result.tokenUsage?.input || 0) + (result.tokenUsage?.output || 0),
          },
        };
      }

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
