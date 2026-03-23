import type { PipelineRun, PipelineStepRun, PrismaClient } from "@prisma/client";
import { enqueueAgentJob } from "../bridge/queue.js";
import { emit } from "../events/emitter.js";
import { createChildLogger } from "../utils/logger.js";
import type { DispatchResult, PipelineStep } from "./index.js";

const log = createChildLogger("pipeline-dispatcher");

type PipelineStatus = "pending" | "running" | "completed" | "failed" | "cancelled";
type StepStatus = "pending" | "queued" | "running" | "completed" | "failed" | "cancelled";

function parseDependsOn(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as string[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function summarizeResult(result: string, maxLength = 500): string {
  if (result.length <= maxLength) return result;
  return `${result.slice(0, maxLength)}...`;
}

export class PipelineDispatcher {
  constructor(private db: PrismaClient) {}

  async createPipelineRun(opts: {
    companyId: string;
    projectId?: string | null;
    issueId?: string | null;
    source: string;
    requestType: string;
    requestedBy: string;
    requestedAgentSlug?: string | null;
    entryAgentSlug: string;
    plan: PipelineStep[];
    clientRequestKey?: string;
  }): Promise<DispatchResult> {
    const pipelineRun = await this.db.pipelineRun.create({
      data: {
        companyId: opts.companyId,
        projectId: opts.projectId ?? null,
        issueId: opts.issueId ?? null,
        source: opts.source,
        requestType: opts.requestType,
        requestedBy: opts.requestedBy,
        requestedAgentSlug: opts.requestedAgentSlug ?? null,
        entryAgentSlug: opts.entryAgentSlug,
        currentStepKey: opts.plan[0]?.key ?? null,
        clientRequestKey: opts.clientRequestKey ?? null,
        planJson: JSON.stringify(opts.plan),
      },
    });

    if (opts.plan.length > 0) {
      await this.db.pipelineStepRun.createMany({
        data: opts.plan.map((step) => ({
          pipelineRunId: pipelineRun.id,
          stepKey: step.key,
          agentSlug: step.agentSlug,
          inputSnapshot: step.input,
          dependsOn: JSON.stringify(step.dependsOn),
        })),
      });
    }

    const queuedStepKeys = await this.enqueueEligibleSteps(pipelineRun.id);

    return {
      pipelineRunId: pipelineRun.id,
      queuedStepKeys,
      pipelineLength: opts.plan.length,
    };
  }

  async enqueueEligibleSteps(pipelineRunId: string): Promise<string[]> {
    const pipelineRun = await this.db.pipelineRun.findUnique({
      where: { id: pipelineRunId },
      include: {
        issue: { include: { project: true } },
        stepRuns: { orderBy: { createdAt: "asc" } },
      },
    });

    if (!pipelineRun) {
      throw new Error(`Pipeline ${pipelineRunId} not found`);
    }

    if (pipelineRun.status === "cancelled" || pipelineRun.status === "failed" || pipelineRun.status === "completed") {
      return [];
    }

    const stepMap = new Map(pipelineRun.stepRuns.map((step) => [step.stepKey, step]));
    const queuedStepKeys: string[] = [];

    for (const stepRun of pipelineRun.stepRuns) {
      if (stepRun.status !== "pending") continue;

      const dependsOn = parseDependsOn(stepRun.dependsOn);
      const ready = dependsOn.every((key) => stepMap.get(key)?.status === "completed");
      if (!ready) continue;

      const jobId = await this.enqueueStepRun(pipelineRun, stepRun);
      queuedStepKeys.push(stepRun.stepKey);

      await this.db.pipelineStepRun.update({
        where: { id: stepRun.id },
        data: {
          status: "queued",
          queueJobId: jobId,
        },
      });
    }

    if (queuedStepKeys.length > 0) {
      await this.db.pipelineRun.update({
        where: { id: pipelineRun.id },
        data: {
          status: "running",
          currentStepKey: queuedStepKeys[0],
        },
      });

      if (pipelineRun.issueId) {
        await this.db.issue.update({
          where: { id: pipelineRun.issueId },
          data: { status: "in_progress" },
        });
        emit({ type: "issue.updated", issueId: pipelineRun.issueId, status: "in_progress" });
      }
    } else if (pipelineRun.stepRuns.every((step) => step.status === "completed")) {
      await this.completePipelineRun(pipelineRun.id);
    }

    return queuedStepKeys;
  }

  async markStepStarted(stepRunId: string): Promise<void> {
    const stepRun = await this.db.pipelineStepRun.findUnique({
      where: { id: stepRunId },
      include: { pipelineRun: true },
    });
    if (!stepRun) return;

    await this.db.pipelineStepRun.update({
      where: { id: stepRunId },
      data: {
        status: "running",
        startedAt: stepRun.startedAt ?? new Date(),
        attempts: { increment: 1 },
      },
    });

    await this.db.pipelineRun.update({
      where: { id: stepRun.pipelineRunId },
      data: {
        status: "running",
        currentStepKey: stepRun.stepKey,
      },
    });

    if (stepRun.pipelineRun.issueId) {
      emit({ type: "issue.updated", issueId: stepRun.pipelineRun.issueId, status: "in_progress" });
    }
  }

  async handleStepSuccess(stepRunId: string, resultSummary: string): Promise<void> {
    const stepRun = await this.db.pipelineStepRun.findUnique({
      where: { id: stepRunId },
      include: { pipelineRun: { include: { stepRuns: true } } },
    });
    if (!stepRun) return;

    await this.db.pipelineStepRun.update({
      where: { id: stepRunId },
      data: {
        status: "completed",
        completedAt: new Date(),
        resultSummary: summarizeResult(resultSummary),
      },
    });

    const queued = await this.enqueueEligibleSteps(stepRun.pipelineRunId);
    if (queued.length > 0) return;

    const latest = await this.db.pipelineStepRun.findMany({
      where: { pipelineRunId: stepRun.pipelineRunId },
    });

    if (latest.every((step) => step.status === "completed")) {
      await this.completePipelineRun(stepRun.pipelineRunId);
    } else if (stepRun.pipelineRun.issueId) {
      emit({ type: "issue.updated", issueId: stepRun.pipelineRun.issueId, status: "in_progress" });
    }
  }

  async handleStepFailure(stepRunId: string, error: string, retryable: boolean): Promise<void> {
    const stepRun = await this.db.pipelineStepRun.findUnique({
      where: { id: stepRunId },
      include: { pipelineRun: true },
    });
    if (!stepRun) return;

    if (retryable) {
      await this.db.pipelineStepRun.update({
        where: { id: stepRunId },
        data: {
          status: "queued",
          resultSummary: summarizeResult(error),
        },
      });
      return;
    }

    await this.db.pipelineStepRun.update({
      where: { id: stepRunId },
      data: {
        status: "failed",
        completedAt: new Date(),
        resultSummary: summarizeResult(error),
      },
    });

    await this.db.pipelineRun.update({
      where: { id: stepRun.pipelineRunId },
      data: {
        status: "failed",
        lastError: error,
        completedAt: new Date(),
      },
    });

    if (stepRun.pipelineRun.issueId) {
      await this.db.issue.update({
        where: { id: stepRun.pipelineRun.issueId },
        data: {
          status: "failed",
          result: error,
          executionLockedAt: null,
          executionAgentSlug: null,
          executionJobId: null,
        },
      });
      emit({ type: "issue.updated", issueId: stepRun.pipelineRun.issueId, status: "failed" });
    }
  }

  async retryStep(pipelineRunId: string, stepKey: string): Promise<string[]> {
    const stepRun = await this.db.pipelineStepRun.findUnique({
      where: { pipelineRunId_stepKey: { pipelineRunId, stepKey } },
      include: { pipelineRun: true },
    });

    if (!stepRun) {
      throw new Error(`Pipeline step ${stepKey} not found`);
    }

    if (stepRun.status !== "failed") {
      throw new Error(`Only failed steps can be retried`);
    }

    await this.db.pipelineStepRun.update({
      where: { id: stepRun.id },
      data: {
        status: "pending",
        queueJobId: null,
        resultSummary: null,
        completedAt: null,
      },
    });

    await this.db.pipelineRun.update({
      where: { id: pipelineRunId },
      data: {
        status: "running",
        lastError: null,
        completedAt: null,
      },
    });

    return this.enqueueEligibleSteps(pipelineRunId);
  }

  async cancelPipeline(pipelineRunId: string): Promise<void> {
    const pipelineRun = await this.db.pipelineRun.findUnique({
      where: { id: pipelineRunId },
      include: { stepRuns: true },
    });
    if (!pipelineRun) {
      throw new Error(`Pipeline ${pipelineRunId} not found`);
    }

    await this.db.pipelineRun.update({
      where: { id: pipelineRunId },
      data: {
        status: "cancelled",
        completedAt: new Date(),
      },
    });

    await this.db.pipelineStepRun.updateMany({
      where: {
        pipelineRunId,
        status: { in: ["pending", "queued", "running"] as StepStatus[] },
      },
      data: {
        status: "cancelled",
        completedAt: new Date(),
      },
    });

    await this.db.queueJob.updateMany({
      where: {
        id: { in: pipelineRun.stepRuns.map((step) => step.queueJobId).filter((value): value is string => Boolean(value)) },
        status: { in: ["pending", "running"] },
      },
      data: {
        status: "cancelled",
        error: "Cancelled by user",
        completedAt: new Date(),
      },
    });

    if (pipelineRun.issueId) {
      await this.db.issue.update({
        where: { id: pipelineRun.issueId },
        data: {
          status: "cancelled",
          executionLockedAt: null,
          executionAgentSlug: null,
          executionJobId: null,
        },
      });
      emit({ type: "issue.updated", issueId: pipelineRun.issueId, status: "cancelled" });
    }
  }

  async getPipeline(pipelineRunId: string) {
    return this.db.pipelineRun.findUnique({
      where: { id: pipelineRunId },
      include: {
        issue: true,
        stepRuns: {
          orderBy: { createdAt: "asc" },
        },
      },
    });
  }

  private async enqueueStepRun(
    pipelineRun: PipelineRun & {
      issue: ({ project: { path: string } | null } & { projectId: string }) | null;
      stepRuns: PipelineStepRun[];
    },
    stepRun: PipelineStepRun,
  ): Promise<string> {
    const projectPath = pipelineRun.issue?.project?.path ?? process.cwd();

    const agent = await this.db.agent.findUnique({
      where: { companyId_slug: { companyId: pipelineRun.companyId, slug: stepRun.agentSlug } },
    });

    if (!agent) {
      const error = `Agent ${stepRun.agentSlug} not found for pipeline ${pipelineRun.id}`;
      log.error({ pipelineRunId: pipelineRun.id, agentSlug: stepRun.agentSlug }, error);
      throw new Error(error);
    }

    return enqueueAgentJob({
      companyId: pipelineRun.companyId,
      agentSlug: stepRun.agentSlug,
      agentId: agent.id,
      input: stepRun.inputSnapshot,
      issueId: pipelineRun.issueId ?? undefined,
      projectPath,
      pipelineRunId: pipelineRun.id,
      pipelineStepRunId: stepRun.id,
    });
  }

  private async completePipelineRun(pipelineRunId: string): Promise<void> {
    const pipelineRun = await this.db.pipelineRun.findUnique({
      where: { id: pipelineRunId },
    });
    if (!pipelineRun || pipelineRun.status === "completed") return;

    await this.db.pipelineRun.update({
      where: { id: pipelineRunId },
      data: {
        status: "completed",
        completedAt: new Date(),
        currentStepKey: null,
      },
    });

    if (pipelineRun.issueId) {
      await this.db.issue.update({
        where: { id: pipelineRun.issueId },
        data: {
          status: "done",
          executionLockedAt: null,
          executionAgentSlug: null,
          executionJobId: null,
        },
      });
      emit({ type: "issue.updated", issueId: pipelineRun.issueId, status: "done" });
    }
  }
}
