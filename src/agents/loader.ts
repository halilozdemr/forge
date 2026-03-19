import { readFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import matter from "gray-matter";
import { createChildLogger } from "../utils/logger.js";

const log = createChildLogger("agent-loader");

export interface AgentDefinition {
  slug: string;
  name: string;
  description: string;
  model: string;
  modelProvider: string;
  mode: "primary" | "subagent";
  temperature: number;
  permissions: Record<string, boolean>;
  reportsTo: string | null;
  heartbeatCron: string | null;
  prompt: string;
}

/** Parse model string from v1 format: "bridge/claude-cli-sonnet" → { provider: "claude-cli", model: "sonnet" } */
function parseModel(modelStr: string): { provider: string; model: string } {
  if (modelStr.startsWith("bridge/")) {
    const parts = modelStr.replace("bridge/", "").split("-");
    return { provider: "claude-cli", model: parts.pop() || "sonnet" };
  }
  if (modelStr.startsWith("openrouter/")) {
    return { provider: "openrouter", model: modelStr.replace("openrouter/", "") };
  }
  if (modelStr.startsWith("anthropic/")) {
    return { provider: "anthropic-api", model: modelStr.replace("anthropic/", "") };
  }
  // Default: assume it's a direct model string for claude-cli
  return { provider: "claude-cli", model: modelStr };
}

export function loadAgentFromFile(filePath: string): AgentDefinition {
  const content = readFileSync(filePath, "utf-8");
  return parseAgentMarkdown(content);
}

export function parseAgentMarkdown(content: string): AgentDefinition {
  const { data: frontmatter, content: prompt } = matter(content);

  const { provider, model } = parseModel(frontmatter.model || "claude-cli/sonnet");

  const permissions: Record<string, boolean> = {};
  if (frontmatter.permission) {
    for (const [key, value] of Object.entries(frontmatter.permission)) {
      permissions[key] = value === "allow" || value === true;
    }
  }

  return {
    slug: frontmatter.id || frontmatter.slug || "unknown",
    name: frontmatter.name || frontmatter.id || "Unknown Agent",
    description: frontmatter.description || "",
    model,
    modelProvider: provider,
    mode: frontmatter.mode || "subagent",
    temperature: frontmatter.temperature || 0.2,
    permissions,
    reportsTo: frontmatter.reportsTo || null,
    heartbeatCron: frontmatter.heartbeatCron || null,
    prompt: prompt.trim(),
  };
}

export function loadBuiltinAgents(): Map<string, AgentDefinition> {
  const defaultsDir = resolve(join(import.meta.dirname, "defaults"));
  const agents = new Map<string, AgentDefinition>();

  const slugs = [
    "receptionist", "pm", "architect", "builder", "reviewer",
    "debugger", "devops", "designer", "scrum_master",
  ];

  for (const slug of slugs) {
    const filePath = join(defaultsDir, `${slug}.md`);
    if (existsSync(filePath)) {
      try {
        const agent = loadAgentFromFile(filePath);
        agents.set(agent.slug, agent);
        log.debug({ slug: agent.slug }, "Loaded built-in agent");
      } catch (err) {
        log.error({ slug, err }, "Failed to load built-in agent");
      }
    }
  }

  log.info(`Loaded ${agents.size} built-in agents`);
  return agents;
}
