import { ClaudeCliRunner } from "./claude-cli.js";
import { OpenRouterRunner } from "./openrouter.js";
import { AnthropicApiRunner } from "./anthropic-api.js";
import { GeminiCliRunner } from "./gemini-cli.js";
import { CodexCliRunner } from "./codex-cli.js";
import { OpenCodeCliRunner } from "./opencode-cli.js";
import { ProcessRunner } from "./process.js";
import { HttpRunner } from "./http.js";
import { CursorRunner } from "./cursor.js";
import type { AgentRunner } from "./types.js";

const runners = new Map<string, AgentRunner>();

export function createRunner(modelProvider: string): AgentRunner {
  if (runners.has(modelProvider)) {
    return runners.get(modelProvider)!;
  }

  let runner: AgentRunner;

  switch (modelProvider) {
    case "claude-cli":
      runner = new ClaudeCliRunner();
      break;
    case "openrouter":
      runner = new OpenRouterRunner();
      break;
    case "anthropic-api":
      runner = new AnthropicApiRunner();
      break;
    case "gemini-cli":
      runner = new GeminiCliRunner();
      break;
    case "codex-cli":
      runner = new CodexCliRunner();
      break;
    case "opencode-cli":
      runner = new OpenCodeCliRunner();
      break;
    case "process":
      runner = new ProcessRunner();
      break;
    case "http":
      runner = new HttpRunner();
      break;
    case "cursor":
      runner = new CursorRunner();
      break;
    default:
      throw new Error(`Unknown model provider: ${modelProvider}. Supported: claude-cli, openrouter, anthropic-api, gemini-cli, codex-cli, opencode-cli, process, http, cursor`);
  }

  runners.set(modelProvider, runner);
  return runner;
}
