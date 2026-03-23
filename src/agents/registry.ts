import type { PrismaClient, Agent } from "@prisma/client";
import { loadBuiltinAgents, type AgentDefinition } from "./loader.js";
import { createChildLogger } from "../utils/logger.js";
import { decrypt } from "../utils/crypto.js";

const log = createChildLogger("agent-registry");
const BUILTIN_ALIAS_MAP: Record<string, string> = {
  receptionist: "ceo",
  builder: "engineer",
  scrum_master: "scrum-master",
};

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
    const agent = this.builtinAgents.get(slug) ?? this.builtinAgents.get(BUILTIN_ALIAS_MAP[slug] || "");
    return agent?.prompt || null;
  }

  /** Get full built-in agent definition */
  getBuiltinDefinition(slug: string): AgentDefinition | null {
    return this.builtinAgents.get(slug) || this.builtinAgents.get(BUILTIN_ALIAS_MAP[slug] || "") || null;
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
    let prompt = this.getBuiltinPrompt(agent.slug) || `You are the ${agent.name} at The Firm.`;

    // Resolve secrets
    const companySecrets = await this.db.companySecret.findMany({
      where: { companyId: agent.companyId }
    });

    for (const s of companySecrets) {
      try {
        const decrypted = decrypt(s.value);
        const placeholder = new RegExp(`{{secrets\.${s.name}}}`, 'g');
        prompt = prompt.replace(placeholder, decrypted);
      } catch (e) {
        log.warn({ secret: s.name }, "Failed to decrypt secret in registry");
      }
    }

    return prompt;
  }
}
