import { createChildLogger } from "../utils/logger.js";
import { getDb } from "../db/client.js";
import { buildFeaturePipeline } from "./pipelines/feature.js";
import { buildBugfixPipeline } from "./pipelines/bugfix.js";
import { buildRefactorPipeline } from "./pipelines/refactor.js";
import { buildReleasePipeline } from "./pipelines/release.js";

const log = createChildLogger("orchestrator");

export interface PipelineStep {
  key: string;
  agentSlug: string;
  input: string;
  /** Keys of steps that must complete before this step runs */
  dependsOn: string[];
}

export interface DispatchResult {
  pipelineRunId: string;
  queuedStepKeys: string[];
  pipelineLength: number;
}

export class FirmOrchestrator {
  async dispatch(opts: {
    companyId: string;
    projectId: string;
    issueId: string;
    issueType: string;
    title: string;
    description?: string;
    source?: string;
    requestedBy?: string;
    clientRequestKey?: string;
  }): Promise<DispatchResult> {
    const db = getDb();
    const { IntakeService } = await import("./intake.js");
    const service = new IntakeService(db);

    log.info({ issueId: opts.issueId, issueType: opts.issueType }, "Dispatching issue via intake service");

    return service.submitExistingIssue({
      companyId: opts.companyId,
      projectId: opts.projectId,
      issueId: opts.issueId,
      type: opts.issueType,
      title: opts.title,
      description: opts.description,
      source: opts.source ?? "api",
      requestedBy: opts.requestedBy ?? "system",
      clientRequestKey: opts.clientRequestKey,
    });
  }

  buildPipeline(issueType: string, opts: { issueId: string; title: string; description?: string }): PipelineStep[] {
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
