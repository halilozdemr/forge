import { ClaudeCliRunner } from "./claude-cli.js";
import { OpenRouterRunner } from "./openrouter.js";
import { AnthropicApiRunner } from "./anthropic-api.js";
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
    default:
      throw new Error(`Unknown model provider: ${modelProvider}. Supported: claude-cli, openrouter, anthropic-api`);
  }

  runners.set(modelProvider, runner);
  return runner;
}
