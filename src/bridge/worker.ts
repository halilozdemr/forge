import { getDb } from "../db/client.js";
import { createRunner } from "./runners/factory.js";
import { BudgetGate } from "./budget-gate.js";
import { createChildLogger } from "../utils/logger.js";
import type { AgentJobData } from "./queue.js";
import { addSyncEvent } from "../sync/worker.js";
import { resolveWorkspace, cleanWorkspace } from "./workspace.js";

const log = createChildLogger("worker");

let isRunning = false;
let pollingTimer: NodeJS.Timeout | null = null;
let activeJobs = 0;

export function createAgentWorker(concurrency = 3): any {
  if (isRunning) return { close: async () => {}, isRunning: () => true, on: () => {} };
  
  isRunning = true;
  
  pollingTimer = setInterval(async () => {
    if (activeJobs >= concurrency) return;
    
    // Atomic claim
    const db = getDb();
    
    try {
      const job = await db.$transaction(async (tx) => {
        const pending = await tx.queueJob.findFirst({
          where: { status: "pending", scheduledAt: { lte: new Date() } },
          orderBy: { scheduledAt: "asc" },
        });
        if (!pending) return null;
        return tx.queueJob.update({
          where: { id: pending.id },
          data: { status: "running", startedAt: new Date(), attempts: { increment: 1 } },
        });
      });

      if (job) {
        activeJobs++;
        processJob(job).finally(() => {
          activeJobs--;
        });
      }
    } catch (e) {
      log.error({ err: (e as Error).message }, "Error polling for queue jobs");
    }
  }, 1000);

  return {
    on: (event: string, cb: any) => {},
    close: async () => {
      isRunning = false;
      if (pollingTimer) clearInterval(pollingTimer);
    },
    isRunning: () => isRunning
  };
}

async function processJob(job: any): Promise<void> {
  const db = getDb();
  const budgetGate = new BudgetGate(db);
  const data: AgentJobData = JSON.parse(job.payload);
  const { companyId, agentSlug, modelProvider, agentModel, systemPrompt, input, permissions, adapterConfig, projectPath, issueId, timeoutMs } = data;

  log.info({ jobId: job.id, agent: agentSlug }, "Processing job");

  try {
    const budgetCheck = await budgetGate.check(companyId, agentSlug);
    if (!budgetCheck.allowed) {
      log.warn({ jobId: job.id, agent: agentSlug }, `Budget blocked: ${budgetCheck.reason}`);
      await db.agent.updateMany({
        where: { companyId, slug: agentSlug },
        data: { status: "paused" },
      });
      const ag = await db.agent.findUnique({ where: { companyId_slug: { companyId, slug: agentSlug } } });
      if (ag) {
        addSyncEvent('agent.updated', { agentId: ag.id, status: "paused", companyId, slug: agentSlug, name: ag.name, role: ag.role });
      }
      throw new Error(`Budget limit exceeded: ${budgetCheck.reason}`);
    }

    if (issueId) {
      await db.issue.update({
        where: { id: issueId },
        data: { status: "in_progress" },
      });
      addSyncEvent('issue.updated', { issueId, status: "in_progress", companyId });
    }

    let effectiveProjectPath = projectPath;
    if (issueId) {
      effectiveProjectPath = await resolveWorkspace(issueId, companyId, agentSlug);
    }

    const runner = createRunner(modelProvider);
    const result = await runner.run({
      projectPath: effectiveProjectPath,
      agentSlug,
      model: agentModel,
      systemPrompt,
      input,
      permissions,
      adapterConfig,
      timeoutMs,
    });

    if (result.tokenUsage) {
      const costUsd = estimateCost(modelProvider, agentModel, result.tokenUsage.input, result.tokenUsage.output);
      const agent = await db.agent.findUnique({
        where: { companyId_slug: { companyId, slug: agentSlug } },
      });
      if (agent) {
        await db.costEvent.create({
          data: {
            companyId,
            agentId: agent.id,
            issueId: issueId || null,
            model: agentModel,
            provider: modelProvider,
            inputTokens: result.tokenUsage.input,
            outputTokens: result.tokenUsage.output,
            costUsd,
            durationMs: result.durationMs,
          },
        });
        
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        const budgetRes = await db.costEvent.aggregate({
          where: { companyId, createdAt: { gte: startOfMonth, lte: endOfMonth } },
          _sum: { costUsd: true }
        });
        const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        addSyncEvent('budget.updated', { companyId, month: monthStr, totalUsd: budgetRes._sum.costUsd || 0 });
      }
    }

    if (issueId) {
      const finalStatus = result.success ? "done" : "failed";
      await db.issue.update({
        where: { id: issueId },
        data: {
          status: finalStatus,
          result: result.output || result.error || null,
          executionLockedAt: null,
          executionAgentSlug: null,
          executionJobId: null,
        },
      });
      addSyncEvent('issue.updated', { issueId, status: finalStatus, companyId });
    }

    await db.queueJob.update({
      where: { id: job.id },
      data: {
        status: result.success ? "completed" : "failed",
        result: result.success ? JSON.stringify({ output: result.output?.slice(0, 10000) }) : undefined,
        error: result.error || null,
        completedAt: new Date(),
      },
    });

    await db.activityLog.create({
      data: {
        companyId,
        actor: agentSlug,
        action: result.success ? "agent.task.completed" : "agent.task.failed",
        resource: issueId ? `issue:${issueId}` : undefined,
        metadata: JSON.stringify({
          durationMs: result.durationMs,
          provider: modelProvider,
        }),
      },
    });

    if (!result.success) {
      throw new Error(result.error || "Agent execution failed");
    }

    if (data.nextAction) {
      const { getQueue } = await import("./queue.js");
      const queue = getQueue();
      const nextAgent = await db.agent.findUnique({
        where: { companyId_slug: { companyId, slug: data.nextAction.agentSlug } },
      });

      if (nextAgent) {
        await queue.add(`agent:${nextAgent.slug}`, {
          companyId,
          agentSlug: nextAgent.slug,
          agentModel: nextAgent.model,
          modelProvider: nextAgent.modelProvider,
          systemPrompt: "",
          input: data.nextAction.input,
          permissions: JSON.parse(nextAgent.permissions) as Record<string, boolean>,
          projectPath,
          issueId,
        });
      }
    }
    
    log.info({ jobId: job.id, agent: agentSlug }, "Job completed");

  } catch (err: any) {
    log.error({ jobId: job.id, agent: agentSlug, error: err.message }, "Job failed");
    const isRetryable = job.attempts < job.maxAttempts;
    await db.queueJob.update({
      where: { id: job.id },
      data: {
        status: isRetryable ? "pending" : "failed",
        error: err.message,
        scheduledAt: isRetryable ? new Date(Date.now() + Math.pow(2, job.attempts) * 1000) : job.scheduledAt,
      }
    });

    if (!isRetryable && issueId) {
      await db.issue.update({
        where: { id: issueId },
        data: {
          status: "failed",
          executionLockedAt: null,
          executionAgentSlug: null,
          executionJobId: null,
        }
      });
    }
  } finally {
    if (issueId) {
      await cleanWorkspace(issueId);
    }
  }
}

export async function closeWorker(): Promise<void> {
  if (isRunning) {
    if (pollingTimer) clearInterval(pollingTimer);
    isRunning = false;
  }
}

export function isWorkerRunning(): boolean {
  return isRunning;
}

function estimateCost(provider: string, model: string, inputTokens: number, outputTokens: number): number {
  if (provider === "claude-cli") return 0;
  if (provider === "anthropic-api") {
    if (model.includes("opus")) return (inputTokens * 15 + outputTokens * 75) / 1_000_000;
    if (model.includes("sonnet")) return (inputTokens * 3 + outputTokens * 15) / 1_000_000;
    if (model.includes("haiku")) return (inputTokens * 0.25 + outputTokens * 1.25) / 1_000_000;
  }
  if (provider === "openrouter") {
    return (inputTokens * 1 + outputTokens * 3) / 1_000_000;
  }
  return 0;
}
