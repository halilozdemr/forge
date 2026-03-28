import type { PipelineRun, PipelineStepRun, PrismaClient } from "@prisma/client";
import { enqueueAgentJob } from "../bridge/queue.js";
import { emit } from "../events/emitter.js";
import { createChildLogger } from "../utils/logger.js";
import type { DispatchResult, PipelineStep } from "./index.js";
import { getHarnessArtifactType, extractStructuredArtifact, validateAndStoreArtifact, assembleHarnessStepContext } from "./harness-artifacts.js";
import { buildSprintSteps } from "./pipelines/harness.js";
import type { ProductSpec, EvaluationReport } from "./artifacts.js";

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

function isStructuredPipelineRun(run: { requestType: string; planJson: string }): boolean {
  // Backward compatibility: legacy structured runs used requestType="harness".
  if (run.requestType === "harness") return true;

  try {
    const plan = JSON.parse(run.planJson || "[]") as Array<{ key?: string }>;
    return Array.isArray(plan) && plan.some((step) => step.key === "planner");
  } catch {
    return false;
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

    // Set to true when a harness sprint outcome requires a human gate.
    // Prevents enqueueEligibleSteps from auto-advancing to the next sprint.
    let harnessAdvancePaused = false;

    // Harness artifact extraction, validation, and persistence.
    // Runs before marking the step completed so a validation failure keeps the step
    // in a failed state rather than leaving it stuck as "completed".
    if (isStructuredPipelineRun(stepRun.pipelineRun)) {
      const artifactType = getHarnessArtifactType(stepRun.stepKey);
      if (artifactType !== null) {
        if (!stepRun.pipelineRun.issueId) {
          await this.handleStepFailure(stepRunId, `Harness step "${stepRun.stepKey}" requires an issueId on the pipeline run but none is set`, false);
          return;
        }
        const raw = extractStructuredArtifact(resultSummary);
        if (!raw) {
          await this.handleStepFailure(stepRunId, `Harness step "${stepRun.stepKey}" did not emit a structured artifact (no JSON block with artifactType field found in output)`, false);
          return;
        }
        if (raw.artifactType !== artifactType) {
          await this.handleStepFailure(stepRunId, `Harness step "${stepRun.stepKey}" emitted artifactType "${String(raw.artifactType)}" but expected "${artifactType}"`, false);
          return;
        }
        try {
          await validateAndStoreArtifact(this.db, {
            artifactType,
            payload: raw,
            issueId: stepRun.pipelineRun.issueId,
            agentSlug: stepRun.agentSlug,
            pipelineRunId: stepRun.pipelineRunId,
            pipelineStepRunId: stepRunId,
            stepKey: stepRun.stepKey,
          });
        } catch (err) {
          await this.handleStepFailure(stepRunId, (err as Error).message, false);
          return;
        }

        // After planner validates, dynamically append sprint steps for sprints 2..N.
        // sprint-1 steps are already in the initial skeleton; only 2..N are new here.
        if (stepRun.stepKey === "planner") {
          const spec = raw as unknown as ProductSpec;
          try {
            await this.appendSprintSteps(stepRun.pipelineRunId, spec);
          } catch (err) {
            await this.handleStepFailure(stepRunId, `Failed to append sprint steps after planner: ${(err as Error).message}`, false);
            return;
          }
        }

        // After sprint-N-evaluate validates, resolve the sprint outcome and update SprintRun.
        // Sets harnessAdvancePaused=true when the outcome requires a human gate so that
        // enqueueEligibleSteps is not called and the next sprint is not auto-advanced.
        const evalMatch = /^sprint-(\d+)-evaluate$/.exec(stepRun.stepKey);
        if (evalMatch) {
          const sprintNumber = parseInt(evalMatch[1], 10);
          const report = raw as unknown as EvaluationReport;
          try {
            const shouldAdvance = await this.resolveSprintOutcome(
              stepRun.pipelineRunId,
              sprintNumber,
              report,
              stepRun.pipelineRun.issueId!,
            );
            harnessAdvancePaused = !shouldAdvance;
          } catch (err) {
            await this.handleStepFailure(stepRunId, `Sprint outcome resolution failed for sprint ${sprintNumber}: ${(err as Error).message}`, false);
            return;
          }
        }
      }
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

    // Harness sprint outcome required human input — do not auto-advance to next sprint.
    if (harnessAdvancePaused) {
      log.info(
        { pipelineRunId: stepRun.pipelineRunId, stepKey: stepRun.stepKey },
        "Harness sprint outcome requires human gate — pipeline advancement paused",
      );
      return;
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

    // Harness pipelines: assemble context from persisted typed artifacts per §8.
    // resultSummary is never read or injected for harness steps.
    // Non-harness pipelines: V1 behaviour — inject prior step resultSummary sections.
    let enrichedInput: string;
    if (isStructuredPipelineRun(pipelineRun)) {
      enrichedInput = await assembleHarnessStepContext(this.db, {
        pipelineRunId: pipelineRun.id,
        stepKey: stepRun.stepKey,
        inputSnapshot: stepRun.inputSnapshot,
      });
    } else {
      const dependsOn = parseDependsOn(stepRun.dependsOn);
      const priorOutputSections = dependsOn
        .map((key) => {
          const prior = pipelineRun.stepRuns.find((s) => s.stepKey === key);
          return prior?.resultSummary ? `## Output from ${key}\n${prior.resultSummary}` : null;
        })
        .filter((s): s is string => s !== null);

      enrichedInput =
        priorOutputSections.length > 0
          ? `${stepRun.inputSnapshot}\n\n---\n${priorOutputSections.join("\n\n")}`
          : stepRun.inputSnapshot;
    }

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

  /**
   * Applies a human approval decision to a harness sprint that is blocked at
   * `approval_pending`. Supported actions:
   *
   *   approve_continue   – accept sprint as-is; advance pipeline to next sprint or complete
   *   approve_with_notes – accept sprint and inject reviewer notes into next sprint's builder context
   *   reject_and_retry   – send execution back to sprint-N-build with per-criterion feedback
   *
   * `skip_criterion` is deferred to a later step: it requires a `skippedCriteria` Json
   * field on SprintRun (schema migration) to persist the exclusion across re-evaluation.
   *
   * An Approval audit record (type="sprint_review") is written for every decision.
   * The SprintRun status is updated deterministically and `enqueueEligibleSteps` is
   * called to resume the pipeline — reusing the existing queue machinery.
   */
  async handleHarnessApprovalDecision(
    pipelineRunId: string,
    sprintNumber: number,
    action: "approve_continue" | "approve_with_notes" | "reject_and_retry",
    opts: {
      notes?: string;
      feedback?: Array<{ criterionId: string; reason: string }>;
      actorId?: string;
    } = {},
  ): Promise<void> {
    const MAX_BUILD_ATTEMPTS = 3;

    const pipelineRun = await this.db.pipelineRun.findUnique({
      where: { id: pipelineRunId },
    });
    if (!pipelineRun) {
      throw new Error(`Pipeline ${pipelineRunId} not found`);
    }
    if (!isStructuredPipelineRun(pipelineRun)) {
      throw new Error(`Pipeline ${pipelineRunId} is not a structured pipeline (type: ${pipelineRun.requestType})`);
    }

    const sprintRun = await this.db.sprintRun.findUnique({
      where: { pipelineRunId_sprintNumber: { pipelineRunId, sprintNumber } },
    });
    if (!sprintRun) {
      throw new Error(`SprintRun not found for pipeline ${pipelineRunId} sprint ${sprintNumber}`);
    }
    if (sprintRun.status !== "approval_pending") {
      throw new Error(
        `Sprint ${sprintNumber} is not in approval_pending state (current: ${sprintRun.status})`,
      );
    }

    const actor = opts.actorId ?? "user";
    const buildKey = `sprint-${sprintNumber}-build`;
    const evaluateKey = `sprint-${sprintNumber}-evaluate`;

    if (action === "approve_continue" || action === "approve_with_notes") {
      // Transition SprintRun → passed
      await this.db.sprintRun.update({
        where: { pipelineRunId_sprintNumber: { pipelineRunId, sprintNumber } },
        data: {
          status: "passed",
          approvalReason: null,
          completedAt: new Date(),
        },
      });

      // approve_with_notes: inject reviewer notes into next sprint's builder inputSnapshot
      // so that assembleHarnessStepContext passes them through as the baseInput layer.
      if (action === "approve_with_notes" && opts.notes) {
        const nextContractKey = `sprint-${sprintNumber + 1}-contract`;
        const nextContractRun = await this.db.pipelineStepRun.findUnique({
          where: { pipelineRunId_stepKey: { pipelineRunId, stepKey: nextContractKey } },
          select: { id: true, inputSnapshot: true },
        });
        if (nextContractRun) {
          const originalInput = nextContractRun.inputSnapshot ?? "";
          await this.db.pipelineStepRun.update({
            where: { id: nextContractRun.id },
            data: {
              inputSnapshot:
                `Human reviewer approved sprint ${sprintNumber} with the following feedback: ${opts.notes}\n\n` +
                originalInput,
            },
          });
          log.info(
            { pipelineRunId, sprintNumber, nextContractKey },
            "handleHarnessApprovalDecision: reviewer notes injected into next sprint context",
          );
        }
      }

      // Audit record
      await this.db.approval.create({
        data: {
          companyId: pipelineRun.companyId,
          type: "sprint_review",
          status: "approved",
          requestedBy: actor,
          reviewedAt: new Date(),
          metadata: JSON.stringify({
            pipelineRunId,
            sprintNumber,
            action,
            approvalReason: sprintRun.approvalReason,
            ...(opts.notes ? { notes: opts.notes } : {}),
          }),
        },
      });

      log.info(
        { pipelineRunId, sprintNumber, action },
        "handleHarnessApprovalDecision: sprint approved — advancing pipeline",
      );

      // Advance: picks up next sprint-contract step or completes pipeline if last sprint
      await this.enqueueEligibleSteps(pipelineRunId);

    } else if (action === "reject_and_retry") {
      if (sprintRun.buildAttempts >= MAX_BUILD_ATTEMPTS) {
        throw new Error(
          `Sprint ${sprintNumber} has exhausted build attempts (${sprintRun.buildAttempts}/${MAX_BUILD_ATTEMPTS}) — cannot retry`,
        );
      }

      // Build feedback context. Criterion descriptions are not fetched here — the
      // builder will have the full SprintContract via assembleHarnessStepContext.
      const feedback = opts.feedback ?? [];
      const feedbackLines =
        feedback.length > 0
          ? feedback.map((f) => `  - Criterion ${f.criterionId}: ${f.reason}`).join("\n")
          : "  (No specific criterion feedback provided — re-evaluate and retry)";

      // Preserve the build step's current inputSnapshot as the base; the feedback
      // block is prepended so assembleHarnessStepContext will include it as baseInput.
      const buildStepRun = await this.db.pipelineStepRun.findUnique({
        where: { pipelineRunId_stepKey: { pipelineRunId, stepKey: buildKey } },
        select: { inputSnapshot: true },
      });
      const originalBuildInput = buildStepRun?.inputSnapshot ?? "";

      const feedbackInput =
        `HUMAN REVIEW — Sprint ${sprintNumber} rejected, retry requested.\n\n` +
        `Feedback per criterion:\n${feedbackLines}\n\n` +
        `Implement the corrections above and emit a new BuildResult artifact.\n\n` +
        originalBuildInput;

      // Reset only sprint-N-build and sprint-N-evaluate to pending.
      // Future sprint steps (sprint-(N+1)-contract etc.) are intentionally NOT reset —
      // they are still pending and depend on sprint-N-evaluate completing successfully.
      for (const stepKey of [buildKey, evaluateKey]) {
        await this.db.pipelineStepRun.update({
          where: { pipelineRunId_stepKey: { pipelineRunId, stepKey } },
          data: {
            status: "pending",
            queueJobId: null,
            completedAt: null,
            resultSummary: null,
            ...(stepKey === buildKey ? { inputSnapshot: feedbackInput } : {}),
          },
        });
      }

      // SprintRun → building (human decided to retry; buildAttempts increments on next evaluate)
      await this.db.sprintRun.update({
        where: { pipelineRunId_sprintNumber: { pipelineRunId, sprintNumber } },
        data: {
          status: "building",
          approvalReason: null,
        },
      });

      // Audit record
      await this.db.approval.create({
        data: {
          companyId: pipelineRun.companyId,
          type: "sprint_review",
          status: "rejected",
          requestedBy: actor,
          reviewedAt: new Date(),
          metadata: JSON.stringify({
            pipelineRunId,
            sprintNumber,
            action,
            feedback,
            approvalReason: sprintRun.approvalReason,
            buildAttemptBeforeRetry: sprintRun.buildAttempts,
          }),
        },
      });

      log.info(
        { pipelineRunId, sprintNumber, buildAttempts: sprintRun.buildAttempts },
        "handleHarnessApprovalDecision: sprint rejected — re-queuing build",
      );

      // Re-queue sprint-N-build (sprint-N-contract-review is still completed → eligible)
      await this.enqueueEligibleSteps(pipelineRunId);
    }
  }

  /**
   * Appends PipelineStepRun rows for sprints 2..N after the planner emits a
   * validated ProductSpec. Sprint-1 steps are already in the initial skeleton
   * and are never touched here.
   *
   * Idempotency guard: if "sprint-2-contract" already exists for this pipeline
   * run, the append is skipped entirely. This covers unexpected re-entry (e.g.
   * planner step retried after a transient error that still persisted the artifact).
   *
   * Called only within the harness artifact block for stepKey === "planner",
   * so it never fires for non-harness pipelines.
   */
  private async appendSprintSteps(pipelineRunId: string, spec: ProductSpec): Promise<void> {
    const totalSprints = spec.sprints.length;
    if (totalSprints <= 1) {
      log.info({ pipelineRunId }, "appendSprintSteps: single-sprint spec — nothing to append");
      return;
    }

    // Idempotency guard: treat sprint-2-contract existence as the canonical signal
    // that this append already ran.
    const already = await this.db.pipelineStepRun.findUnique({
      where: { pipelineRunId_stepKey: { pipelineRunId, stepKey: "sprint-2-contract" } },
    });
    if (already) {
      log.warn({ pipelineRunId }, "appendSprintSteps: sprint-2-contract already exists — skipping duplicate append");
      return;
    }

    // Build PipelineStep definitions for sprints 2..N.
    // Each sprint's contract step depends on the previous sprint's evaluate step.
    const newSteps: PipelineStep[] = [];
    for (let n = 2; n <= totalSprints; n++) {
      const firstDependsOn = `sprint-${n - 1}-evaluate`;
      const steps = buildSprintSteps(n, firstDependsOn, {
        title: spec.title,
        description: spec.summary,
      });
      newSteps.push(...steps);
    }

    // Read current planJson before the transaction so we can compute the new value.
    // planJson is only modified by appendSprintSteps (post-planner) and createPipelineRun,
    // so reading it here and updating it atomically with the step rows is safe.
    const run = await this.db.pipelineRun.findUnique({
      where: { id: pipelineRunId },
      select: { planJson: true },
    });
    const existingPlan = JSON.parse(run?.planJson || "[]") as PipelineStep[];
    const newPlanJson = JSON.stringify([...existingPlan, ...newSteps]);

    // Atomically persist new step rows and updated planJson together.
    await this.db.$transaction([
      this.db.pipelineStepRun.createMany({
        data: newSteps.map((step) => ({
          pipelineRunId,
          stepKey: step.key,
          agentSlug: step.agentSlug,
          inputSnapshot: step.input,
          dependsOn: JSON.stringify(step.dependsOn),
        })),
      }),
      this.db.pipelineRun.update({
        where: { id: pipelineRunId },
        data: { planJson: newPlanJson },
      }),
    ]);

    log.info(
      { pipelineRunId, sprintsAppended: totalSprints - 1, totalSprints },
      "appendSprintSteps: appended sprint steps for harness pipeline",
    );
  }

  /**
   * Applies the §6 sprint outcome rules to a validated EvaluationReport and upserts
   * the SprintRun row for the given sprint.
   *
   * Returns true if the pipeline should advance to the next sprint (outcome = "passed"),
   * false if it should pause for a human gate (outcome = "approval_pending").
   *
   * Auto-retry is permanently OFF for the pilot (HARNESS_AUTO_RETRY=false).
   * Rule 1 (blockers) therefore always resolves to approval_pending/build_retry_limit
   * rather than looping back to sprint-N-build automatically.
   *
   * Intentionally deferred (documented):
   * - Harness pre-acceptance checks beyond Zod (gitRefTested = BuildResult.gitRef verification,
   *   per-criterion toolsUsed completeness) — Zod layer covers schema invariants; deterministic
   *   cross-field checks are a Step 9+ hardening item.
   * - SprintRun.contractRevisions tracking — needs a hook in the contract-review REJECTED path,
   *   not in the evaluate path. Deferred to a follow-up hardening step.
   */
  private async resolveSprintOutcome(
    pipelineRunId: string,
    sprintNumber: number,
    report: EvaluationReport,
    issueId: string,
  ): Promise<boolean> {
    // -------------------------------------------------------------------------
    // Look up artifact IDs for this sprint's three artifact-emitting steps.
    // Queried by pipelineStepRunId so we get the correct sprint's artifacts even
    // in multi-sprint pipelines where artifact types repeat across sprints.
    // -------------------------------------------------------------------------
    const contractKey  = `sprint-${sprintNumber}-contract`;
    const buildKey     = `sprint-${sprintNumber}-build`;
    const evaluateKey  = `sprint-${sprintNumber}-evaluate`;

    const stepRuns = await this.db.pipelineStepRun.findMany({
      where: { pipelineRunId, stepKey: { in: [contractKey, buildKey, evaluateKey] } },
      select: { stepKey: true, id: true },
    });
    const stepRunIdByKey = new Map(stepRuns.map((s) => [s.stepKey, s.id]));

    const stepRunIds = [contractKey, buildKey, evaluateKey]
      .map((k) => stepRunIdByKey.get(k))
      .filter((id): id is string => Boolean(id));

    const workProducts = stepRunIds.length > 0
      ? await this.db.issueWorkProduct.findMany({
          where: {
            pipelineRunId,
            pipelineStepRunId: { in: stepRunIds },
            artifactType: { in: ["SprintContract", "BuildResult", "EvaluationReport"] },
          },
          select: { id: true, pipelineStepRunId: true },
        })
      : [];

    const artifactByStepRunId = new Map(workProducts.map((wp) => [wp.pipelineStepRunId, wp.id]));
    const contractArtifactId   = artifactByStepRunId.get(stepRunIdByKey.get(contractKey)  ?? "") ?? null;
    const buildArtifactId      = artifactByStepRunId.get(stepRunIdByKey.get(buildKey)     ?? "") ?? null;
    const evaluationArtifactId = artifactByStepRunId.get(stepRunIdByKey.get(evaluateKey)  ?? "") ?? null;

    // -------------------------------------------------------------------------
    // §6 Sprint outcome rules — evaluated in order, first match wins.
    // -------------------------------------------------------------------------
    const machine_required_failed  = report.blockers.length > 0;
    const machine_required_blocked = report.notVerifiableMachineRequired.length > 0;
    const machine_passed           = report.machinePassed;
    const requires_human           = report.requiresHumanReview;

    let newStatus: string;
    let approvalReason: string | null = null;

    if (machine_required_failed) {
      // Rule 1 — machine criteria failed.
      // HARNESS_AUTO_RETRY=false: skip the intermediate "failed + loop" path.
      // Always gate on human input; increment buildAttempts for audit.
      newStatus = "approval_pending";
      approvalReason = "build_retry_limit";
    } else if (machine_required_blocked) {
      // Rule 2 — required machine criterion is not verifiable by evaluator tools.
      newStatus = "approval_pending";
      approvalReason = "not_verifiable_required_machine";
    } else if (machine_passed && requires_human) {
      // Rule 3 — machine criteria passed; required human criteria need review.
      // This is the normal path for sprints with human criteria.
      newStatus = "approval_pending";
      approvalReason = "human_review_required";
    } else if (machine_passed && !requires_human) {
      // Rule 4 — all machine criteria passed; no human criteria.
      newStatus = "passed";
      approvalReason = null;
    } else {
      // Unexpected combination (machinePassed=false, no blockers, not blocked).
      // Should not occur if the Zod schema invariant (machinePassed false when blockers>0)
      // is enforced, but handled defensively.
      log.warn(
        { pipelineRunId, sprintNumber, machinePassed: machine_passed, blockers: report.blockers },
        "resolveSprintOutcome: unexpected EvaluationReport combination — defaulting to approval_pending",
      );
      newStatus = "approval_pending";
      approvalReason = "build_retry_limit";
    }

    // -------------------------------------------------------------------------
    // Upsert SprintRun — create on first evaluation, update on retry.
    // buildAttempts increments on every evaluate cycle (including first).
    // -------------------------------------------------------------------------
    await this.db.sprintRun.upsert({
      where: { pipelineRunId_sprintNumber: { pipelineRunId, sprintNumber } },
      create: {
        pipelineRunId,
        sprintNumber,
        status: newStatus,
        approvalReason,
        buildAttempts: 1,
        contractArtifactId,
        buildArtifactId,
        evaluationArtifactId,
        completedAt: newStatus === "passed" ? new Date() : null,
      },
      update: {
        status: newStatus,
        approvalReason,
        buildAttempts: { increment: 1 },
        ...(contractArtifactId   ? { contractArtifactId }   : {}),
        ...(buildArtifactId      ? { buildArtifactId }      : {}),
        ...(evaluationArtifactId ? { evaluationArtifactId } : {}),
        completedAt: newStatus === "passed" ? new Date() : null,
      },
    });

    log.info(
      { pipelineRunId, sprintNumber, newStatus, approvalReason },
      "resolveSprintOutcome: SprintRun updated",
    );

    return newStatus === "passed";
  }
}
