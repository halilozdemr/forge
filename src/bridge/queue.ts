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
  pipelineRunId?: string;
  pipelineStepRunId?: string;
  nextAction?: {
    agentSlug: string;
    input: string;
  };
}

const DEFAULT_LEASE_MS = 30_000;

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
    },
    getJob: async (id: string) => {
      const db = getDb();
      const job = await db.queueJob.findUnique({ where: { id } });
      if (!job) return null;

      return {
        id: job.id,
        data: JSON.parse(job.payload),
        progress: job.status === "completed" ? 100 : job.status === "running" ? 50 : 0,
        returnvalue: job.result ? JSON.parse(job.result) : null,
        failedReason: job.error,
        getState: async () => job.status,
      };
    },
  };
}

export async function closeQueue(): Promise<void> {
  // no-op
}

export async function getRedisStatus(): Promise<boolean> {
  return true;
}

export async function claimNextJob(workerId: string, leaseMs = DEFAULT_LEASE_MS) {
  const db = getDb();
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + leaseMs);

  return db.$transaction(async (tx) => {
    const pending = await tx.queueJob.findFirst({
      where: {
        OR: [
          { status: "pending", scheduledAt: { lte: now } },
          { status: "running", leaseExpiresAt: { lt: now } },
        ],
      },
      orderBy: { scheduledAt: "asc" },
    });

    if (!pending) return null;

    return tx.queueJob.update({
      where: { id: pending.id },
      data: {
        status: "running",
        startedAt: pending.startedAt ?? now,
        attempts: { increment: 1 },
        workerId,
        leaseExpiresAt,
        lastHeartbeatAt: now,
      },
    });
  });
}

export async function renewJobLease(jobId: string, workerId: string, leaseMs = DEFAULT_LEASE_MS): Promise<void> {
  const db = getDb();
  const now = new Date();
  await db.queueJob.updateMany({
    where: { id: jobId, workerId, status: "running" },
    data: {
      lastHeartbeatAt: now,
      leaseExpiresAt: new Date(now.getTime() + leaseMs),
    },
  });
}

export async function enqueueAgentJob(opts: {
  companyId: string;
  agentSlug: string;
  agentId: string;
  input: string;
  issueId?: string;
  projectPath?: string;
  pipelineRunId?: string;
  pipelineStepRunId?: string;
  nextAction?: { agentSlug: string; input: string };
}): Promise<string> {
  const db = getDb();

  if (opts.issueId) {
    const issue = await db.issue.findUnique({
      where: { id: opts.issueId },
      select: { executionLockedAt: true },
    });

    if (issue?.executionLockedAt == null) {
      const lockResult = await db.issue.updateMany({
        where: { id: opts.issueId, executionLockedAt: null },
        data: {
          executionLockedAt: new Date(),
          executionAgentSlug: opts.agentSlug,
        },
      });

      if (lockResult.count === 0 && !opts.pipelineRunId) {
        throw new Error(`Issue ${opts.issueId} is already being executed.`);
      }
    } else if (!opts.pipelineRunId) {
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
    projectPath: opts.projectPath ?? process.cwd(),
    issueId: opts.issueId,
    sessionId: await resolveSession(opts.agentId, opts.issueId),
    pipelineRunId: opts.pipelineRunId,
    pipelineStepRunId: opts.pipelineStepRunId,
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
      data: {
        executionJobId: jobId,
        executionAgentSlug: opts.agentSlug,
      },
    });
  }

  return jobId;
}
