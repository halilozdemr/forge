import { createChildLogger } from "../utils/logger.js";
import { getDb } from "../db/client.js";
import { getQueue } from "../bridge/queue.js";
import { buildFeaturePipeline } from "./pipelines/feature.js";
import { buildBugfixPipeline } from "./pipelines/bugfix.js";
import { buildRefactorPipeline } from "./pipelines/refactor.js";
import { buildReleasePipeline } from "./pipelines/release.js";

const log = createChildLogger("orchestrator");

export interface PipelineStep {
  agentSlug: string;
  input: string;
  /** Slugs of agents that must complete before this step runs */
  dependsOn: string[];
}

export interface DispatchResult {
  jobIds: string[];
  pipelineLength: number;
}

/**
 * FirmOrchestrator: dispatches multi-agent pipelines based on issue type.
 * Each pipeline step is enqueued with a `nextAction` pointer to the next step,
 * so the BullMQ worker chains them automatically.
 */
export class FirmOrchestrator {
  async dispatch(opts: {
    companyId: string;
    projectId: string;
    issueId: string;
    issueType: string;
    title: string;
    description?: string;
    projectPath?: string;
  }): Promise<DispatchResult> {
    const { companyId, issueId, issueType, title, description } = opts;
    const projectPath = opts.projectPath ?? process.cwd();

    const steps = this.buildPipeline(issueType, { issueId, title, description });

    if (!steps.length) {
      throw new Error(`Unknown issue type: ${issueType}`);
    }

    log.info({ companyId, issueId, issueType, steps: steps.length }, "Dispatching pipeline");

    const db = getDb();
    const q = getQueue({} as any); // queue must be initialized via start command
    const { AgentRegistry } = await import("../agents/registry.js");
    const registry = new AgentRegistry(db);
    const jobIds: string[] = [];

    // Enqueue steps as a linked chain: each step carries nextAction for the next step.
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const nextStep = steps[i + 1];

      // Look up agent in DB
      const agent = await db.agent.findFirst({ where: { companyId, slug: step.agentSlug } });
      if (!agent) {
        log.warn({ agentSlug: step.agentSlug, companyId }, "Agent not found, skipping step");
        continue;
      }

      const systemPrompt = await registry.resolvePrompt(agent);

      // Only enqueue the first step directly — subsequent steps are chained via nextAction
      if (i === 0) {
        const job = await q.add(`pipeline:${issueType}:step-0`, {
          companyId,
          agentSlug: step.agentSlug,
          agentModel: agent.model,
          modelProvider: agent.modelProvider,
          systemPrompt,
          input: step.input,
          permissions: (agent.permissions as Record<string, boolean>) ?? {},
          projectPath,
          issueId,
          nextAction: nextStep
            ? { agentSlug: nextStep.agentSlug, input: nextStep.input }
            : undefined,
        });
        jobIds.push(job.id!);
      }
    }

    // Update issue status to in_progress
    await db.issue.update({
      where: { id: issueId },
      data: { status: "in_progress" },
    });

    // Log activity
    await db.activityLog.create({
      data: {
        companyId,
        actor: "system",
        action: "pipeline.dispatched",
        resource: `issue:${issueId}`,
        metadata: {
          issueType,
          pipelineLength: steps.length,
          firstAgent: steps[0].agentSlug,
        },
      },
    });

    return { jobIds, pipelineLength: steps.length };
  }

  private buildPipeline(issueType: string, opts: { issueId: string; title: string; description?: string }): PipelineStep[] {
    switch (issueType) {
      case "feature":
        return buildFeaturePipeline(opts);
      case "bug":
        return buildBugfixPipeline(opts);
      case "refactor":
        return buildRefactorPipeline(opts);
      case "release":
        return buildReleasePipeline(opts);
      default:
        return buildFeaturePipeline(opts); // default to feature
    }
  }
}
