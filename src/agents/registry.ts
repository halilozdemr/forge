import type { PrismaClient, Agent } from "@prisma/client";
import { loadBuiltinAgents, type AgentDefinition } from "./loader.js";
import { createChildLogger } from "../utils/logger.js";

const log = createChildLogger("agent-registry");

export class AgentRegistry {
  private builtinAgents: Map<string, AgentDefinition>;

  constructor(private db: PrismaClient) {
    this.builtinAgents = loadBuiltinAgents();
  }

  /** Get agent from database by company + slug */
  async getAgent(companyId: string, slug: string): Promise<Agent | null> {
    return this.db.agent.findUnique({
      where: { companyId_slug: { companyId, slug } },
    });
  }

  /** Get all agents for a company */
  async listAgents(companyId: string): Promise<Agent[]> {
    return this.db.agent.findMany({
      where: { companyId },
      orderBy: { slug: "asc" },
    });
  }

  /** Get built-in agent definition (for prompt loading) */
  getBuiltinPrompt(slug: string): string | null {
    const agent = this.builtinAgents.get(slug);
    return agent?.prompt || null;
  }

  /** Get full built-in agent definition */
  getBuiltinDefinition(slug: string): AgentDefinition | null {
    return this.builtinAgents.get(slug) || null;
  }

  /** Resolve the system prompt for an agent: custom file > built-in default */
  async resolvePrompt(agent: Agent): Promise<string> {
    // Custom prompt file takes priority
    if (agent.promptFile) {
      try {
        const { readFileSync } = await import("fs");
        return readFileSync(agent.promptFile, "utf-8");
      } catch {
        log.warn({ slug: agent.slug, file: agent.promptFile }, "Custom prompt file not found, using built-in");
      }
    }

    // Fall back to built-in
    return this.getBuiltinPrompt(agent.slug) || `You are the ${agent.name} at The Firm.`;
  }
}
