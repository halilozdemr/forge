import type { FastifyInstance } from "fastify";
import { getDb } from "../../db/client.js";
import { IntakeService } from "../../orchestrator/intake.js";
import { PipelineDispatcher } from "../../orchestrator/dispatcher.js";
import { loadConfig } from "../../utils/config.js";
import { isOfficialAgentSlug } from "../../agents/constants.js";

async function resolveProjectId() {
  const db = getDb();
  const config = loadConfig();

  const projectForCurrentPath = await db.project.findFirst({
    where: { path: config.projectPath },
    orderBy: { createdAt: "desc" },
  });

  if (projectForCurrentPath) return projectForCurrentPath.id;

  const project = await db.project.findFirst({
    orderBy: { createdAt: "asc" },
  });

  return project?.id ?? null;
}

export async function intakeRoutes(server: FastifyInstance) {
  server.post<{
    Body: {
      source: "claude-code" | "opencode" | "api";
      type: "feature" | "bug" | "refactor" | "release" | "direct";
      title: string;
      description?: string;
      briefMarkdown?: string;
      requestedAgentSlug?: string;
      requestedBy: string;
      clientContext?: string;
      projectId?: string;
      clientRequestKey?: string;
    };
  }>("/intake/requests", async (request, reply) => {
    const projectId = request.body.projectId ?? await resolveProjectId();
    if (!projectId) {
      return reply.code(400).send({ error: "Could not resolve projectId for intake request" });
    }

    if (request.body.type === "direct" && !request.body.requestedAgentSlug) {
      return reply.code(400).send({ error: "requestedAgentSlug is required for direct requests" });
    }
    if (request.body.type === "direct" && request.body.requestedAgentSlug && isOfficialAgentSlug(request.body.requestedAgentSlug)) {
      return reply.code(400).send({
        error: "Direct run is disabled for official agents. Use intake-first official request types.",
      });
    }

    const service = new IntakeService(getDb());
    const result = await service.submitRequest({
      ...request.body,
      projectId,
    });

    return {
      issueId: result.issueId,
      pipelineRunId: result.pipelineRunId,
      status: result.status,
      entryAgentSlug: result.entryAgentSlug,
      queuedStepKeys: result.queuedStepKeys,
    };
  });

  server.get<{ Params: { id: string } }>("/pipelines/:id", async (request, reply) => {
    const dispatcher = new PipelineDispatcher(getDb());
    const pipeline = await dispatcher.getPipeline(request.params.id);
    if (!pipeline) {
      return reply.code(404).send({ error: "Pipeline not found" });
    }

    return { pipeline };
  });

  server.get<{ Params: { id: string } }>("/pipelines/:id/steps", async (request, reply) => {
    const pipeline = await getDb().pipelineRun.findUnique({
      where: { id: request.params.id },
      include: {
        stepRuns: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!pipeline) {
      return reply.code(404).send({ error: "Pipeline not found" });
    }

    return { steps: pipeline.stepRuns };
  });

  server.post<{ Params: { id: string } }>("/pipelines/:id/cancel", async (request, reply) => {
    const dispatcher = new PipelineDispatcher(getDb());
    await dispatcher.cancelPipeline(request.params.id);
    return { cancelled: true };
  });

  server.post<{ Params: { id: string; stepKey: string } }>("/pipelines/:id/steps/:stepKey/retry", async (request, reply) => {
    const dispatcher = new PipelineDispatcher(getDb());
    const queuedStepKeys = await dispatcher.retryStep(request.params.id, request.params.stepKey);
    return { queuedStepKeys };
  });
}
