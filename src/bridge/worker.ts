import { Worker } from "bullmq";
import type { ConnectionOptions } from "bullmq";
import { getDb } from "../db/client.js";
import { createRunner } from "./runners/factory.js";
import { BudgetGate } from "./budget-gate.js";
import { createChildLogger } from "../utils/logger.js";
import type { AgentJobData } from "./queue.js";

const log = createChildLogger("worker");

let worker: Worker<AgentJobData> | null = null;

export function createAgentWorker(
  connection: ConnectionOptions,
  concurrency = 3,
): Worker<AgentJobData> {
  const db = getDb();
  const budgetGate = new BudgetGate(db);

  worker = new Worker<AgentJobData>(
    "agent-tasks",
    async (job) => {
      const { companyId, agentSlug, modelProvider, agentModel, systemPrompt, input, permissions, projectPath, issueId, timeoutMs } = job.data;

      log.info({ jobId: job.id, agent: agentSlug }, "Processing job");

      // 1. Budget check
      const budgetCheck = await budgetGate.check(companyId, agentSlug);
      if (!budgetCheck.allowed) {
        log.warn({ jobId: job.id, agent: agentSlug }, `Budget blocked: ${budgetCheck.reason}`);

        // Pause agent
        await db.agent.updateMany({
          where: { companyId, slug: agentSlug },
          data: { status: "paused" },
        });

        throw new Error(`Budget limit exceeded: ${budgetCheck.reason}`);
      }

      // 2. Update issue status
      if (issueId) {
        await db.issue.update({
          where: { id: issueId },
          data: { status: "in_progress" },
        });
      }

      // 3. Mirror job in PostgreSQL
      await db.queueJob.upsert({
        where: { bullmqJobId: job.id! },
        update: { status: "processing", startedAt: new Date(), attempts: job.attemptsMade },
        create: {
          bullmqJobId: job.id!,
          companyId,
          agentSlug,
          issueId: issueId || null,
          status: "processing",
          startedAt: new Date(),
          attempts: job.attemptsMade,
        },
      });

      // 4. Execute agent
      const runner = createRunner(modelProvider);
      const result = await runner.run({
        projectPath,
        agentSlug,
        model: agentModel,
        systemPrompt,
        input,
        permissions,
        timeoutMs,
      });

      // 5. Record cost event
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
        }
      }

      // 6. Update issue status
      if (issueId) {
        await db.issue.update({
          where: { id: issueId },
          data: {
            status: result.success ? "done" : "failed",
            result: result.output || result.error || null,
          },
        });
      }

      // 7. Update queue job mirror
      await db.queueJob.update({
        where: { bullmqJobId: job.id! },
        data: {
          status: result.success ? "completed" : "failed",
          result: result.success ? { output: result.output?.slice(0, 10000) } : null,
          error: result.error || null,
          completedAt: new Date(),
        },
      });

      // 8. Log activity
      await db.activityLog.create({
        data: {
          companyId,
          actor: agentSlug,
          action: result.success ? "agent.task.completed" : "agent.task.failed",
          resource: issueId ? `issue:${issueId}` : undefined,
          metadata: {
            durationMs: result.durationMs,
            provider: modelProvider,
          },
        },
      });

      if (!result.success) {
        throw new Error(result.error || "Agent execution failed");
      }

      // 9. Chain next action if specified
      if (job.data.nextAction) {
        const { getQueue } = await import("./queue.js");
        const queue = getQueue(connection);
        const nextAgent = await db.agent.findUnique({
          where: { companyId_slug: { companyId, slug: job.data.nextAction.agentSlug } },
        });

        if (nextAgent) {
          await queue.add(`agent:${nextAgent.slug}`, {
            companyId,
            agentSlug: nextAgent.slug,
            agentModel: nextAgent.model,
            modelProvider: nextAgent.modelProvider,
            systemPrompt: "", // loaded from agent defaults
            input: job.data.nextAction.input,
            permissions: nextAgent.permissions as Record<string, boolean>,
            projectPath,
            issueId,
          });
        }
      }

      return {
        success: true,
        output: result.output?.slice(0, 5000),
        durationMs: result.durationMs,
      };
    },
    {
      connection,
      concurrency,
      limiter: { max: 10, duration: 60_000 },
    },
  );

  worker.on("completed", (job) => {
    log.info({ jobId: job.id, agent: job.data.agentSlug }, "Job completed");
  });

  worker.on("failed", (job, err) => {
    log.error({ jobId: job?.id, agent: job?.data.agentSlug, error: err.message }, "Job failed");
  });

  worker.on("stalled", (jobId) => {
    log.warn({ jobId }, "Job stalled — BullMQ will retry");
  });

  return worker;
}

export async function closeWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
}

/** Estimate cost in USD based on provider and token counts. */
function estimateCost(provider: string, model: string, inputTokens: number, outputTokens: number): number {
  // Claude CLI subscription = $0 (flat rate)
  if (provider === "claude-cli") return 0;

  // Anthropic API pricing (approximate)
  if (provider === "anthropic-api") {
    if (model.includes("opus")) return (inputTokens * 15 + outputTokens * 75) / 1_000_000;
    if (model.includes("sonnet")) return (inputTokens * 3 + outputTokens * 15) / 1_000_000;
    if (model.includes("haiku")) return (inputTokens * 0.25 + outputTokens * 1.25) / 1_000_000;
  }

  // OpenRouter — rough estimates
  if (provider === "openrouter") {
    // Most models are cheaper
    return (inputTokens * 1 + outputTokens * 3) / 1_000_000;
  }

  return 0;
}
