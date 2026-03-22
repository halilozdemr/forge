import { getDb } from "../db/client.js";
import { createChildLogger } from "../utils/logger.js";
import { AgentRegistry } from "../agents/registry.js";

const log = createChildLogger("queue");

export interface AgentJobData {
  companyId: string;
  agentSlug: string;
  agentModel: string;
  modelProvider: string;
  systemPrompt: string;
  input: string;
  permissions: Record<string, boolean>;
  projectPath: string;
  issueId?: string;
  timeoutMs?: number;
  nextAction?: {
    agentSlug: string;
    input: string;
  };
}

export async function addJob(params: {
  companyId: string;
  agentSlug: string;
  issueId?: string;
  payload?: Record<string, unknown>;
  scheduledAt?: Date;
}): Promise<string> {
  const db = getDb();
  const job = await db.queueJob.create({
    data: {
      companyId: params.companyId,
      agentSlug: params.agentSlug,
      issueId: params.issueId,
      payload: params.payload ? JSON.stringify(params.payload) : "{}",
      scheduledAt: params.scheduledAt || new Date()
    }
  });
  return job.id;
}

export function getQueue(connection?: any): any {
  return {
    add: async (name: string, data: any) => {
      const id = await addJob({
        companyId: data.companyId,
        agentSlug: data.agentSlug,
        issueId: data.issueId,
        payload: data,
      });
      return { id };
    }
  };
}

export async function closeQueue(): Promise<void> {
  // no-op
}

export async function getRedisStatus(): Promise<boolean> {
  return false; 
}

export async function enqueueAgentJob(opts: {
  companyId: string;
  agentSlug: string;
  agentId: string;
  input: string;
  issueId?: string;
  nextAction?: { agentSlug: string; input: string };
}): Promise<string> {
  const db = getDb();
  const agent = await db.agent.findFirst({
    where: { id: opts.agentId },
  });
  if (!agent) throw new Error(`Agent ${opts.agentId} not found`);

  const registry = new AgentRegistry(db);
  const systemPrompt = await registry.resolvePrompt(agent);

  const payload: AgentJobData = {
    companyId: opts.companyId,
    agentSlug: opts.agentSlug,
    agentModel: agent.model,
    modelProvider: agent.modelProvider,
    systemPrompt,
    input: opts.input,
    permissions: JSON.parse(agent.permissions) as Record<string, boolean>,
    projectPath: process.cwd(),
    issueId: opts.issueId,
    nextAction: opts.nextAction,
  };

  return await addJob({
    companyId: opts.companyId,
    agentSlug: opts.agentSlug,
    issueId: opts.issueId,
    payload: payload as any,
  });
}
