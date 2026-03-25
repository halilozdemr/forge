import type { PrismaClient } from "@prisma/client";
import { createChildLogger } from "../utils/logger.js";
import { FirmOrchestrator, type DispatchResult, type PipelineStep } from "./index.js";
import { PipelineDispatcher } from "./dispatcher.js";
import { OFFICIAL_ENTRY_AGENT_SLUG } from "../agents/constants.js";

const log = createChildLogger("intake-service");

function combineDescription(parts: Array<string | undefined | null>): string | undefined {
  const rendered = parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));
  return rendered.length > 0 ? rendered.join("\n\n") : undefined;
}

export class IntakeService {
  constructor(private db: PrismaClient) {}

  async submitRequest(opts: {
    source: string;
    type: "feature" | "bug" | "refactor" | "release" | "direct";
    title: string;
    description?: string;
    briefMarkdown?: string;
    requestedAgentSlug?: string;
    requestedBy: string;
    clientContext?: string;
    projectId: string;
    clientRequestKey?: string;
  }): Promise<DispatchResult & { issueId: string; status: string; entryAgentSlug: string }> {
    const project = await this.db.project.findUnique({
      where: { id: opts.projectId },
    });

    if (!project) {
      throw new Error(`Project ${opts.projectId} not found`);
    }

    if (opts.clientRequestKey) {
      const existing = await this.db.pipelineRun.findUnique({
        where: {
          companyId_clientRequestKey: {
            companyId: project.companyId,
            clientRequestKey: opts.clientRequestKey,
          },
        },
      });

      if (existing) {
        const stepRuns = await this.db.pipelineStepRun.findMany({
          where: { pipelineRunId: existing.id },
        });
        return {
          issueId: existing.issueId ?? "",
          pipelineRunId: existing.id,
          queuedStepKeys: stepRuns.filter((step) => step.status === "queued").map((step) => step.stepKey),
          pipelineLength: stepRuns.length,
          status: existing.status,
          entryAgentSlug: existing.entryAgentSlug,
        };
      }
    }

    const issueDescription = combineDescription([
      opts.description,
      opts.briefMarkdown,
      opts.clientContext ? `Client context:\n${opts.clientContext}` : undefined,
    ]);

    const issue = await this.db.issue.create({
      data: {
        projectId: project.id,
        title: opts.title,
        description: issueDescription,
        type: opts.type,
        status: "todo",
      },
    });

    const result = await this.submitExistingIssue({
      companyId: project.companyId,
      projectId: project.id,
      issueId: issue.id,
      type: opts.type,
      title: issue.title,
      description: issue.description ?? undefined,
      source: opts.source,
      requestedBy: opts.requestedBy,
      requestedAgentSlug: opts.requestedAgentSlug,
      clientRequestKey: opts.clientRequestKey,
    });

    const pipeline = await this.db.pipelineRun.findUnique({ where: { id: result.pipelineRunId } });

    return {
      ...result,
      issueId: issue.id,
      status: pipeline?.status ?? "pending",
      entryAgentSlug: pipeline?.entryAgentSlug ?? OFFICIAL_ENTRY_AGENT_SLUG,
    };
  }

  async submitExistingIssue(opts: {
    companyId: string;
    projectId: string;
    issueId: string;
    type: string;
    title: string;
    description?: string;
    source: string;
    requestedBy: string;
    requestedAgentSlug?: string;
    clientRequestKey?: string;
  }): Promise<DispatchResult> {
    const plan = this.buildPlan({
      issueId: opts.issueId,
      type: opts.type,
      title: opts.title,
      description: opts.description,
      requestedAgentSlug: opts.requestedAgentSlug,
    });

    if (plan.length === 0) {
      throw new Error(`No pipeline steps were generated for type ${opts.type}`);
    }

    const dispatcher = new PipelineDispatcher(this.db);
    const result = await dispatcher.createPipelineRun({
      companyId: opts.companyId,
      projectId: opts.projectId,
      issueId: opts.issueId,
      source: opts.source,
      requestType: opts.type,
      requestedBy: opts.requestedBy,
      requestedAgentSlug: opts.requestedAgentSlug ?? null,
      entryAgentSlug: plan[0].agentSlug,
      plan,
      clientRequestKey: opts.clientRequestKey,
    });

    await this.db.activityLog.create({
      data: {
        companyId: opts.companyId,
        actor: opts.requestedBy,
        action: "pipeline.created",
        resource: `pipeline:${result.pipelineRunId}`,
        metadata: JSON.stringify({
          issueId: opts.issueId,
          type: opts.type,
          queuedStepKeys: result.queuedStepKeys,
        }),
      },
    });

    log.info(
      { pipelineRunId: result.pipelineRunId, issueId: opts.issueId, type: opts.type },
      "Created pipeline run from intake",
    );

    return result;
  }

  private buildPlan(opts: {
    issueId: string;
    type: string;
    title: string;
    description?: string;
    requestedAgentSlug?: string;
  }): PipelineStep[] {
    if (opts.type === "direct") {
      if (!opts.requestedAgentSlug) {
        throw new Error("requestedAgentSlug is required for direct runs");
      }

      return [
        {
          key: OFFICIAL_ENTRY_AGENT_SLUG,
          agentSlug: OFFICIAL_ENTRY_AGENT_SLUG,
          input: combineDescription([
            "Direct run request received. Normalize input into execution_brief first.",
            opts.title,
            opts.description,
          ]) ?? opts.title,
          dependsOn: [],
        },
        {
          key: "direct",
          agentSlug: opts.requestedAgentSlug,
          input: combineDescription([
            `Direct extension run for ${opts.requestedAgentSlug}.`,
            opts.title,
            opts.description,
          ]) ?? opts.title,
          dependsOn: [OFFICIAL_ENTRY_AGENT_SLUG],
        },
      ];
    }

    const orchestrator = new FirmOrchestrator();
    return orchestrator.buildPipeline(opts.type, {
      issueId: opts.issueId,
      title: opts.title,
      description: opts.description,
    });
  }
}
