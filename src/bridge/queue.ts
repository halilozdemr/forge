import { getDb } from "../db/client.js";
import { createChildLogger } from "../utils/logger.js";
import { AgentRegistry } from "../agents/registry.js";
import { resolveSession } from "./session.js";

const log = createChildLogger("queue");

export interface AgentJobData {
  companyId: string;
  agentSlug: string;
  agentModel: string;
  modelProvider: string;
  systemPrompt: string;
  input: string;
  permissions: Record<string, boolean>;
  adapterConfig?: Record<string, any>;
  projectPath: string;
  issueId?: string;
  sessionId?: string;
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
  return true;
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

  if (opts.issueId) {
    const lockResult = await db.issue.updateMany({
      where: { id: opts.issueId, executionLockedAt: null },
      data: {
        executionLockedAt: new Date(),
        executionAgentSlug: opts.agentSlug,
      },
    });

    if (lockResult.count === 0) {
      throw new Error(`Issue ${opts.issueId} is already being executed.`);
    }
  }

  const agent = await db.agent.findFirst({
    where: { id: opts.agentId },
  });
  if (!agent) throw new Error(`Agent ${opts.agentId} not found`);

  const registry = new AgentRegistry(db);
  const systemPrompt = await registry.resolvePrompt(agent);

  let goalContext = "";
  if (opts.issueId) {
    const issue = await db.issue.findUnique({ where: { id: opts.issueId } });
    if (issue?.goalId) {
      const { buildGoalChainContext } = await import("../utils/goal.js");
      goalContext = await buildGoalChainContext(db, issue.goalId);
    }
  }

  const finalInput = goalContext ? `${goalContext}\n${opts.input}` : opts.input;

  const payload: AgentJobData = {
    companyId: opts.companyId,
    agentSlug: opts.agentSlug,
    agentModel: agent.model,
    modelProvider: agent.modelProvider,
    systemPrompt,
    input: finalInput,
    permissions: JSON.parse(agent.permissions) as Record<string, boolean>,
    adapterConfig: JSON.parse(agent.adapterConfig || "{}"),
    projectPath: process.cwd(),
    issueId: opts.issueId,
    sessionId: await resolveSession(opts.agentId, opts.issueId),
    nextAction: opts.nextAction,
  };

  const jobId = await addJob({
    companyId: opts.companyId,
    agentSlug: opts.agentSlug,
    issueId: opts.issueId,
    payload: payload as any,
  });

  if (opts.issueId) {
    await db.issue.update({
      where: { id: opts.issueId },
      data: { executionJobId: jobId },
    });
  }

  return jobId;
}
