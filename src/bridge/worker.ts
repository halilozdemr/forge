import { getDb } from "../db/client.js";
import { createRunner } from "./runners/factory.js";
import { BudgetGate } from "./budget-gate.js";
import { createChildLogger } from "../utils/logger.js";
import type { AgentJobData } from "./queue.js";
import { claimNextJob, renewJobLease } from "./queue.js";
import { addSyncEvent } from "../sync/worker.js";
import { resolveWorkspace, cleanWorkspace } from "./workspace.js";
import { updateSessionUsage, shouldRotate, rotateSession } from "./session.js";
import { decrypt, redactSecrets } from "../utils/crypto.js";
import { emit } from "../events/emitter.js";
import { PipelineDispatcher } from "../orchestrator/dispatcher.js";
import { sanitizeStreamChunk, extractStreamJsonText, appendLiveBuffer, LIVE_SUMMARY_MAX_CHARS } from "./stream-helpers.js";
import { runPreGuardrail, runPostGuardrail, formatGuardrailError } from "./guardrail.js";


const log = createChildLogger("worker");
const LEASE_MS = 30_000;
const LEASE_RENEW_MS = 10_000;
const WORKER_ID = `worker-${process.pid}`;
const LIVE_SUMMARY_FLUSH_MS = 1500;
const LIVE_SUMMARY_MIN_CHARS = 120;
const LOG_FLUSH_INTERVAL_MS = 2000;
const LOG_FLUSH_BATCH_SIZE = 50;

let isRunning = false;
let pollingTimer: NodeJS.Timeout | null = null;
let activeJobs = 0;

export function createAgentWorker(concurrency = 3): any {
  if (isRunning) return { close: async () => {}, isRunning: () => true, on: () => {} };
  
  isRunning = true;
  
  pollingTimer = setInterval(async () => {
    if (activeJobs >= concurrency) return;

    try {
      const job = await claimNextJob(WORKER_ID, LEASE_MS);

      if (job) {
        activeJobs++;
        processJob(job).finally(() => {
          activeJobs--;
        });
      }
    } catch (e) {
      log.error({ err: (e as Error).message }, "Error polling for queue jobs");
    }
  }, 200);

  return {
    on: (event: string, cb: any) => {},
    close: async () => {
      isRunning = false;
      if (pollingTimer) clearInterval(pollingTimer);
    },
    isRunning: () => isRunning
  };
}


function resolveAgentTimeoutMs(agentSlug: string, requestedTimeoutMs?: number): number {
  if (requestedTimeoutMs) return requestedTimeoutMs;

  switch (agentSlug) {
    case "intake-gate":
      return 2 * 60 * 1000;
    case "architect":
    case "builder":
    case "quality-guard":
      return 8 * 60 * 1000;
    case "devops":
    case "retrospective-analyst":
      return 4 * 60 * 1000;
    default:
      return 3 * 60 * 1000;
  }
}

async function processJob(job: any): Promise<void> {
  const db = getDb();
  const budgetGate = new BudgetGate(db);
  const dispatcher = new PipelineDispatcher(db);
  const data: AgentJobData = JSON.parse(job.payload);
  const { companyId, agentSlug, modelProvider, agentModel, systemPrompt, input, permissions, adapterConfig, projectPath, issueId, sessionId, timeoutMs } = data;

  // Fetch and decrypt secrets
  const companySecrets = await db.companySecret.findMany({ where: { companyId } });
  const secrets: Record<string, string> = {};
  for (const s of companySecrets) {
    try {
      secrets[s.name] = decrypt(s.value);
    } catch (e) {
      log.warn({ secret: s.name }, "Failed to decrypt secret");
    }
  }

  // Resolve placeholders in prompt and input
  let effectiveSystemPrompt = systemPrompt;
  let effectiveInput = input;
  for (const [name, value] of Object.entries(secrets)) {
    const placeholder = new RegExp(`{{secrets\.${name}}}`, 'g');
    effectiveSystemPrompt = effectiveSystemPrompt.replace(placeholder, value);
    effectiveInput = effectiveInput.replace(placeholder, value);
  }

  log.info({ jobId: job.id, agent: agentSlug }, "Processing job");
  emit({ type: "queue.job.started", jobId: job.id, agentSlug });

  const leaseTimer = setInterval(() => {
    renewJobLease(job.id, WORKER_ID, LEASE_MS).catch((err) => {
      log.warn({ jobId: job.id, err: (err as Error).message }, "Failed to renew queue job lease");
    });
  }, LEASE_RENEW_MS);

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

    if (data.pipelineStepRunId) {
      await dispatcher.markStepStarted(data.pipelineStepRunId);
    }

    // Pre-run guardrail: block dangerous operations before execution
    const preCheck = runPreGuardrail(effectiveInput, modelProvider);
    if (preCheck.blocked) {
      throw new Error(formatGuardrailError("pre", preCheck.violations));
    }

    let effectiveProjectPath = projectPath;
    if (issueId) {
      effectiveProjectPath = await resolveWorkspace(issueId, companyId, agentSlug);
    }

    const runner = createRunner(modelProvider);
    let liveBuffer = "";
    let pendingLineBuffer = "";
    let lastLiveFlushAt = 0;
    let liveBufferDirty = false;
    let liveFlushPromise: Promise<void> | null = null;

    // Step log batching — never awaited inside onStream
    let logBatch: Array<{ text: string; chunkIndex: number }> = [];
    let logChunkIndex = 0;
    let lastLogFlushAt = 0;
    let logFlushPromise: Promise<void> | null = null;

    const flushLogs = async (force = false) => {
      if (!data.pipelineStepRunId || logBatch.length === 0) return;
      const now = Date.now();
      if (!force && (now - lastLogFlushAt) < LOG_FLUSH_INTERVAL_MS && logBatch.length < LOG_FLUSH_BATCH_SIZE) return;
      const toFlush = logBatch.splice(0);
      if (toFlush.length === 0) return;
      lastLogFlushAt = now;
      await db.pipelineStepLog.createMany({
        data: toFlush.map(item => ({
          pipelineStepRunId: data.pipelineStepRunId!,
          chunkIndex: item.chunkIndex,
          text: item.text,
        })),
      });
    };

    const flushLiveSummary = async (force = false) => {
      if (!data.pipelineStepRunId || !issueId || !liveBufferDirty) return;

      const now = Date.now();
      if (!force) {
        if ((now - lastLiveFlushAt) < LIVE_SUMMARY_FLUSH_MS) return;
        if (liveBuffer.length < LIVE_SUMMARY_MIN_CHARS) return;
      }

      const excerpt = liveBuffer.trim();
      if (!excerpt) return;

      lastLiveFlushAt = now;
      liveBufferDirty = false;

      await db.pipelineStepRun.update({
        where: { id: data.pipelineStepRunId },
        data: { resultSummary: excerpt },
      });

      emit({ type: "issue.updated", issueId, status: "in_progress" });
    };

    const result = await runner.run({
      projectPath: effectiveProjectPath,
      agentSlug,
      model: agentModel,
      systemPrompt: effectiveSystemPrompt,
      input: effectiveInput,
      permissions,
      adapterConfig,
      env: secrets, // Inject secrets as environment variables
      sessionId,
      timeoutMs: resolveAgentTimeoutMs(agentSlug, timeoutMs),
      onStream: (chunk) => {
        const redacted = redactSecrets(chunk, secrets);
        const sanitized = sanitizeStreamChunk(redacted);
        if (!sanitized) return;

        pendingLineBuffer = `${pendingLineBuffer}${sanitized}`;
        const lines = pendingLineBuffer.split("\n");
        pendingLineBuffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const text = extractStreamJsonText(trimmed);
          if (!text) continue;
          // text may contain embedded newlines from assistant messages
          for (const subLine of text.split("\n")) {
            const t = subLine.trim();
            if (!t) continue;
            emit({ type: "heartbeat.log", agentSlug, line: t });
            liveBuffer = appendLiveBuffer(liveBuffer, `${t}\n`);
            liveBufferDirty = true;
            if (data.pipelineStepRunId) {
              logBatch.push({ text: t, chunkIndex: logChunkIndex++ });
            }
          }
        }

        if (pendingLineBuffer.trim()) {
          liveBuffer = appendLiveBuffer(liveBuffer, pendingLineBuffer.trim());
          liveBufferDirty = true;
        }

        if (!liveFlushPromise) {
          liveFlushPromise = flushLiveSummary().finally(() => {
            liveFlushPromise = null;
          });
        }

        if (data.pipelineStepRunId && !logFlushPromise) {
          logFlushPromise = flushLogs().finally(() => {
            logFlushPromise = null;
          });
        }
      }
    });

    if (pendingLineBuffer.trim()) {
      const text = extractStreamJsonText(pendingLineBuffer.trim());
      if (text) {
        emit({ type: "heartbeat.log", agentSlug, line: text });
        liveBuffer = appendLiveBuffer(liveBuffer, `${text}\n`);
        liveBufferDirty = true;
        if (data.pipelineStepRunId) {
          logBatch.push({ text, chunkIndex: logChunkIndex++ });
        }
      }
    }

    await flushLiveSummary(true);
    await flushLogs(true);

    // Post-run guardrail: check output for credential leaks or private keys
    if (result.success && result.output) {
      const postCheck = runPostGuardrail(result.output, modelProvider);
      if (postCheck.blocked) {
        throw new Error(formatGuardrailError("post", postCheck.violations));
      }
    }

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

        // Phase 5: Session Usage and Rotation
        await updateSessionUsage(agent.id, issueId || undefined, result.tokenUsage);
        
        const runtimeState = await db.agentRuntimeState.findUnique({ where: { agentId: agent.id } });
        if (runtimeState && shouldRotate(runtimeState as any, agent)) {
          const { handoffNote } = await rotateSession(agent.id, issueId || undefined);
          if (handoffNote && data.nextAction) {
            data.nextAction.input = handoffNote + "\n\n" + data.nextAction.input;
          }
        }
      }
    }

    if (issueId && !data.pipelineStepRunId) {
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
        leaseExpiresAt: null,
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

    if (result.success && issueId) {
      // Create work products
      const output = result.output || "";

      // 1. Extract code blocks
      const codeBlockRegex = /```(?:\w+)?\n([\s\S]*?)```/g;
      let match;
      while ((match = codeBlockRegex.exec(output)) !== null) {
        const code = match[1].trim();
        if (code) {
          await db.issueWorkProduct.create({
            data: {
              issueId,
              agentSlug,
              type: "code",
              title: "Generated Code",
              content: code,
              pipelineRunId: data.pipelineRunId ?? null,
              pipelineStepRunId: data.pipelineStepRunId ?? null,
              artifactType: "code_block",
            }
          });
        }
      }

      // 2. Analysis product (first 500 chars)
      await db.issueWorkProduct.create({
        data: {
          issueId,
          agentSlug,
          type: "analysis",
          title: "Execution Analysis",
          content: output.slice(0, 500) + (output.length > 500 ? "..." : ""),
          pipelineRunId: data.pipelineRunId ?? null,
          pipelineStepRunId: data.pipelineStepRunId ?? null,
          artifactType: "execution_summary",
        }
      });

      // 3. Completion comment
      await db.issueComment.create({
        data: {
          issueId,
          authorSlug: agentSlug,
          content: `Agent ${agentSlug} completed the task.`,
        }
      });
    }

    if (!result.success) {
      throw new Error(result.error || "Agent execution failed");
    }

    if (data.pipelineStepRunId) {
      await dispatcher.handleStepSuccess(data.pipelineStepRunId, result.output || "");

      if (data.pipelineRunId && issueId) {
        const pipeline = await dispatcher.getPipeline(data.pipelineRunId);
        if (pipeline && ["completed", "failed", "cancelled"].includes(pipeline.status)) {
          await cleanWorkspace(issueId);
        }
      }
    } else if (data.nextAction) {
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
    emit({ type: "queue.job.completed", jobId: job.id, success: true });


  } catch (err: any) {
    const redactedError = redactSecrets(err.message, secrets);
    log.error({ jobId: job.id, agent: agentSlug, error: redactedError }, "Job failed");
    const isRetryable = job.attempts < job.maxAttempts;
    await db.queueJob.update({
      where: { id: job.id },
      data: {
        status: isRetryable ? "pending" : "failed",
        error: err.message,
        scheduledAt: isRetryable ? new Date(Date.now() + Math.pow(2, job.attempts) * 1000) : job.scheduledAt,
        leaseExpiresAt: null,
      }
    });

    emit({ type: "queue.job.completed", jobId: job.id, success: false });

    if (data.pipelineStepRunId) {
      await dispatcher.handleStepFailure(data.pipelineStepRunId, err.message, isRetryable);

      if (!isRetryable && data.pipelineRunId && issueId) {
        const pipeline = await dispatcher.getPipeline(data.pipelineRunId);
        if (pipeline && ["completed", "failed", "cancelled"].includes(pipeline.status)) {
          await cleanWorkspace(issueId);
        }
      }
    }

    if (!data.pipelineStepRunId && !isRetryable && issueId) {
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
    clearInterval(leaseTimer);
    if (issueId && !data.pipelineStepRunId) {
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
