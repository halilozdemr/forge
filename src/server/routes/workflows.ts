import type { FastifyInstance } from "fastify";
import { getDb } from "../../db/client.js";

export async function workflowRoutes(server: FastifyInstance) {
  // GET /v1/workflows — list workflow runs with optional filters
  server.get<{
    Querystring: {
      companyId?: string;
      projectId?: string;
      status?: string;
      type?: string;
      cursor?: string;
      limit?: string;
    };
  }>("/workflows", async (request, reply) => {
    const db = getDb();
    const { companyId, projectId, status, type, cursor, limit } = request.query;
    const take = Math.min(parseInt(limit ?? "50", 10) || 50, 200);

    const where: Record<string, unknown> = {};
    if (companyId) where.companyId = companyId;
    if (projectId) where.projectId = projectId;
    if (status) where.status = status;
    if (type) where.requestType = type;

    const runs = await db.pipelineRun.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        stepRuns: {
          select: { status: true },
        },
        issue: { select: { id: true, title: true, type: true } },
      },
    });

    const workflows = runs.map((run) => {
      const total = run.stepRuns.length;
      const completed = run.stepRuns.filter((s) => s.status === "completed").length;
      return {
        id: run.id,
        type: run.requestType,
        status: run.status,
        entryAgentSlug: run.entryAgentSlug,
        currentStepKey: run.currentStepKey,
        progress: { completed, total },
        issueId: run.issueId,
        issueTitle: run.issue?.title ?? null,
        requestedBy: run.requestedBy,
        lastError: run.lastError,
        createdAt: run.createdAt,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
      };
    });

    const nextCursor = runs.length === take ? runs[runs.length - 1].id : null;
    return { workflows, nextCursor };
  });

  // GET /v1/workflows/:id — detail with step timeline
  server.get<{ Params: { id: string } }>("/workflows/:id", async (request, reply) => {
    const db = getDb();
    const run = await db.pipelineRun.findUnique({
      where: { id: request.params.id },
      include: {
        stepRuns: { orderBy: { createdAt: "asc" } },
        issue: { select: { id: true, title: true, type: true, status: true } },
      },
    });

    if (!run) {
      return reply.code(404).send({ error: "Workflow not found" });
    }

    const total = run.stepRuns.length;
    const completed = run.stepRuns.filter((s) => s.status === "completed").length;
    const failed = run.stepRuns.filter((s) => s.status === "failed").length;

    const steps = run.stepRuns.map((s) => ({
      stepKey: s.stepKey,
      agentSlug: s.agentSlug,
      status: s.status,
      attempts: s.attempts,
      startedAt: s.startedAt,
      completedAt: s.completedAt,
      resultSummary: s.resultSummary
        ? s.resultSummary.slice(0, 300)
        : null,
    }));

    return {
      workflow: {
        id: run.id,
        type: run.requestType,
        status: run.status,
        entryAgentSlug: run.entryAgentSlug,
        currentStepKey: run.currentStepKey,
        progress: { completed, failed, total },
        issueId: run.issueId,
        issue: run.issue,
        requestedBy: run.requestedBy,
        lastError: run.lastError,
        createdAt: run.createdAt,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        steps,
      },
    };
  });

  // GET /v1/workflows/:id/logs — paginated step log replay
  server.get<{
    Params: { id: string };
    Querystring: { stepKey?: string; cursor?: string; limit?: string };
  }>("/workflows/:id/logs", async (request, reply) => {
    const db = getDb();
    const { stepKey, cursor, limit } = request.query;

    if (!stepKey) {
      return reply.code(400).send({ error: "stepKey query parameter is required" });
    }

    const take = Math.min(parseInt(limit ?? "200", 10) || 200, 500);

    const stepRun = await db.pipelineStepRun.findUnique({
      where: { pipelineRunId_stepKey: { pipelineRunId: request.params.id, stepKey } },
      select: { id: true },
    });

    if (!stepRun) {
      return { logs: [], nextCursor: null, stepKey };
    }

    const afterIndex = cursor !== undefined ? (parseInt(cursor, 10) || 0) : -1;

    const rows = await db.pipelineStepLog.findMany({
      where: {
        pipelineStepRunId: stepRun.id,
        chunkIndex: { gt: afterIndex },
      },
      orderBy: { chunkIndex: "asc" },
      take: take + 1,
      select: { chunkIndex: true, text: true, createdAt: true },
    });

    const hasMore = rows.length > take;
    const logs = hasMore ? rows.slice(0, take) : rows;
    const nextCursor = hasMore ? logs[logs.length - 1].chunkIndex : null;

    return { logs, nextCursor, stepKey };
  });

  // GET /v1/workflows/:id/artifacts — work products for a pipeline run
  server.get<{ Params: { id: string } }>("/workflows/:id/artifacts", async (request, reply) => {
    const db = getDb();
    const artifacts = await db.issueWorkProduct.findMany({
      where: { pipelineRunId: request.params.id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        agentSlug: true,
        type: true,
        artifactType: true,
        title: true,
        content: true,
        filePath: true,
        pipelineStepRunId: true,
        createdAt: true,
      },
    });
    return { artifacts };
  });
}
