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

function summarizeResult(result: string, maxLength = 8000): string {
  if (result.length <= maxLength) return result;
  return `${result.slice(0, maxLength)}...`;
}

function parseReviewerDecision(output: string): { decision: "APPROVED" | "REJECTED"; issues: string[] } | null {
  // Scan backwards for the last JSON block starting with {"decision"
  const lastIndex = output.lastIndexOf('{"decision"');
  if (lastIndex === -1) return null;
  try {
    // Find the matching closing brace
    let depth = 0;
    let end = lastIndex;
    for (let i = lastIndex; i < output.length; i++) {
      if (output[i] === "{") depth++;
      else if (output[i] === "}") {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    const parsed = JSON.parse(output.slice(lastIndex, end + 1)) as { decision?: string; issues?: unknown };
    if (parsed.decision !== "APPROVED" && parsed.decision !== "REJECTED") return null;
    const issues = Array.isArray(parsed.issues) ? (parsed.issues as string[]) : [];
    return { decision: parsed.decision as "APPROVED" | "REJECTED", issues };
  } catch {
    return null;
  }
}

function getTransitiveDependents(allStepRuns: { stepKey: string; dependsOn: string }[], targetStepKey: string): string[] {
  const result = new Set<string>();
  const queue = [targetStepKey];
  while (queue.length > 0) {
    const current = queue.shift()!;
    result.add(current);
    for (const step of allStepRuns) {
      const deps = JSON.parse(step.dependsOn || "[]") as string[];
      if (deps.includes(current) && !result.has(step.stepKey)) {
        queue.push(step.stepKey);
      }
    }
  }
  return Array.from(result);
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

    // Guard: stale job arriving after this step was reset to pending
    if (stepRun.status !== "running") {
      log.warn({ stepRunId, status: stepRun.status }, "handleStepSuccess called on non-running step — ignoring stale job");
      return;
    }

    await this.db.pipelineStepRun.update({
      where: { id: stepRunId },
      data: {
        status: "completed",
        completedAt: new Date(),
        resultSummary: summarizeResult(resultSummary),
      },
    });

    // Feedback loop: check if this step should loop back to a previous step on REJECTED
    const plan = JSON.parse(stepRun.pipelineRun.planJson || "[]") as { key: string; input: string; loopsBackTo?: string; maxRevisions?: number }[];
    const planStep = plan.find((s) => s.key === stepRun.stepKey);

    if (planStep?.loopsBackTo) {
      const decision = parseReviewerDecision(resultSummary);
      if (decision?.decision === "REJECTED") {
        const targetStepKey = planStep.loopsBackTo;
        const maxRevisions = planStep.maxRevisions ?? 3;
        const targetStepRun = stepRun.pipelineRun.stepRuns.find((s) => s.stepKey === targetStepKey);

        if (!targetStepRun) {
          log.warn({ stepRunId, targetStepKey }, "loopsBackTo target step not found — proceeding normally");
        } else if (targetStepRun.attempts >= maxRevisions) {
          log.warn({ stepRunId, targetStepKey, attempts: targetStepRun.attempts, maxRevisions }, "Max revisions reached — hard failing pipeline");
          await this.handleStepFailure(stepRunId, `Max revisions (${maxRevisions}) reached. Last rejection: ${decision.issues.join("; ")}`, false);
          return;
        } else {
          // Build enriched input from original plan + revision info + reviewer feedback
          const originalInput = plan.find((s) => s.key === targetStepKey)?.input ?? targetStepRun.inputSnapshot;
          const issueLines = decision.issues.length > 0 ? decision.issues.map((i) => `- ${i}`).join("\n") : "See reviewer output above.";
          const feedbackInput = `REVISION ${targetStepRun.attempts + 1} — Reviewer rejected previous implementation.\n\n## Reviewer Feedback\n${issueLines}\n\n## Original Task\n${originalInput}`;

          // Reset target step + all transitive dependents back to pending
          const stepsToReset = getTransitiveDependents(stepRun.pipelineRun.stepRuns, targetStepKey);
          for (const stepKey of stepsToReset) {
            await this.db.pipelineStepRun.update({
              where: { pipelineRunId_stepKey: { pipelineRunId: stepRun.pipelineRunId, stepKey } },
              data: {
                status: "pending",
                queueJobId: null,
                completedAt: null,
                resultSummary: null,
                ...(stepKey === targetStepKey ? { inputSnapshot: feedbackInput } : {}),
              },
            });
          }

          log.info({ pipelineRunId: stepRun.pipelineRunId, targetStepKey, revision: targetStepRun.attempts + 1 }, "Reviewer rejected — resetting for revision");
          await this.enqueueEligibleSteps(stepRun.pipelineRunId);
          return;
        }
      }
    }

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

    // Inject outputs from all prerequisite steps so each stage receives full context
    const dependsOn = parseDependsOn(stepRun.dependsOn);
    const priorOutputSections = dependsOn
      .map((key) => {
        const prior = pipelineRun.stepRuns.find((s) => s.stepKey === key);
        return prior?.resultSummary ? `## Output from ${key}\n${prior.resultSummary}` : null;
      })
      .filter((s): s is string => s !== null);

    const enrichedInput =
      priorOutputSections.length > 0
        ? `${stepRun.inputSnapshot}\n\n---\n${priorOutputSections.join("\n\n")}`
        : stepRun.inputSnapshot;

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
      input: enrichedInput,
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
