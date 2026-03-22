import type { FastifyInstance } from "fastify";
import { getDb } from "../../db/client.js";
import { FirmOrchestrator } from "../../orchestrator/index.js";

export async function issueRoutes(server: FastifyInstance) {
  const db = getDb();

  // GET /v1/issues?projectId=xxx&status=open
  server.get<{ Querystring: { projectId?: string; status?: string; companyId?: string } }>("/issues", async (request) => {
    const { projectId, status, companyId } = request.query;
    const where: Record<string, unknown> = {};
    if (projectId) where.projectId = projectId;
    if (status) where.status = status;
    if (companyId) {
      where.project = { companyId };
    }

    const issues = await db.issue.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { assignedAgent: { select: { slug: true, name: true } } },
    });

    return { issues };
  });

  // GET /v1/issues/:id
  server.get<{ Params: { id: string } }>("/issues/:id", async (request, reply) => {
    const issue = await db.issue.findUnique({
      where: { id: request.params.id },
      include: {
        assignedAgent: { select: { slug: true, name: true } },
        sprint: { select: { id: true, number: true, goal: true } },
        subIssues: true,
      },
    });

    if (!issue) return reply.code(404).send({ error: "Issue not found" });
    return { issue };
  });

  // POST /v1/issues
  server.post<{
    Body: {
      projectId: string;
      title: string;
      description?: string;
      type?: string;
      priority?: string;
      assignedAgentId?: string;
      sprintId?: string;
      parentIssueId?: string;
    };
  }>("/issues", async (request) => {
    const issue = await db.issue.create({ data: request.body });

    // Log activity
    const project = await db.project.findUnique({ where: { id: request.body.projectId } });
    if (project) {
      await db.activityLog.create({
        data: {
          companyId: project.companyId,
          actor: "user",
          action: "issue.created",
          resource: `issue:${issue.id}`,
          metadata: JSON.stringify({ title: issue.title, type: issue.type }),
        },
      });
    }

    // Auto-dispatch pipeline when issue is created with a supported type
    if (project && ["feature", "bug", "refactor", "release"].includes(issue.type)) {
      const orchestrator = new FirmOrchestrator();
      orchestrator
        .dispatch({
          companyId: project.companyId,
          projectId: project.id,
          issueId: issue.id,
          issueType: issue.type,
          title: issue.title,
          description: issue.description ?? undefined,
          projectPath: project.path,
        })
        .catch((err: Error) => {
          // Non-fatal: log but don't fail the HTTP response
          console.error(`Pipeline dispatch failed for issue ${issue.id}: ${err.message}`);
        });
    }

    return { issue };
  });

  // PUT /v1/issues/:id
  server.put<{
    Params: { id: string };
    Body: {
      status?: string;
      assignedAgentId?: string;
      result?: string;
      sprintId?: string;
      metadata?: Record<string, unknown>;
    };
  }>("/issues/:id", async (request, reply) => {
    const existing = await db.issue.findUnique({ where: { id: request.params.id } });
    if (!existing) return reply.code(404).send({ error: "Issue not found" });

    const { status, assignedAgentId, result, sprintId, metadata } = request.body;
    const issue = await db.issue.update({
      where: { id: request.params.id },
      data: {
        ...(status !== undefined && { status }),
        ...(result !== undefined && { result }),
        ...(metadata !== undefined && { metadata: JSON.stringify(metadata) }),
        ...(assignedAgentId !== undefined && {
          assignedAgent: assignedAgentId
            ? { connect: { id: assignedAgentId } }
            : { disconnect: true },
        }),
        ...(sprintId !== undefined && {
          sprint: sprintId ? { connect: { id: sprintId } } : { disconnect: true },
        }),
      },
    });

    return { issue };
  });

  // POST /v1/issues/:id/run
  server.post<{
    Params: { id: string };
    Body: { companyId: string; agentSlug?: string };
  }>("/issues/:id/run", async (request, reply) => {
    const issue = await db.issue.findUnique({
      where: { id: request.params.id },
      include: { assignedAgent: true },
    });
    if (!issue) return reply.code(404).send({ error: "Issue not found" });

    const agentSlug = request.body.agentSlug ?? issue.assignedAgent?.slug;
    if (!agentSlug) {
      return reply.code(400).send({ error: "No agent assigned to issue and no override provided." });
    }

    const agent = await db.agent.findFirst({
      where: { companyId: request.body.companyId, slug: agentSlug }
    });
    if (!agent) {
      return reply.code(404).send({ error: "Agent not found" });
    }

    const { enqueueAgentJob } = await import("../../bridge/queue.js");
    const jobId = await enqueueAgentJob({
      companyId: request.body.companyId,
      agentSlug: agent.slug,
      agentId: agent.id,
      issueId: issue.id,
      input: `Execute issue: ${issue.title}\n\n${issue.description ?? ""}`,
    });

    return { jobId };
  });

  // GET /v1/issues/:id/comments
  server.get<{ Params: { id: string } }>("/issues/:id/comments", async (request, reply) => {
    const comments = await db.issueComment.findMany({
      where: { issueId: request.params.id },
      orderBy: { createdAt: "asc" },
    });
    return { comments };
  });

  // POST /v1/issues/:id/comments
  server.post<{
    Params: { id: string };
    Body: { authorSlug: string; content: string };
  }>("/issues/:id/comments", async (request, reply) => {
    const comment = await db.issueComment.create({
      data: {
        issueId: request.params.id,
        authorSlug: request.body.authorSlug,
        content: request.body.content,
      },
    });
    return { comment };
  });

  // GET /v1/issues/:id/work-products
  server.get<{ Params: { id: string } }>("/issues/:id/work-products", async (request, reply) => {
    const workProducts = await db.issueWorkProduct.findMany({
      where: { issueId: request.params.id },
      orderBy: { createdAt: "desc" },
    });
    return { workProducts };
  });

  // POST /v1/issues/:id/work-products
  server.post<{
    Params: { id: string };
    Body: { agentSlug: string; type: string; title: string; content: string; filePath?: string };
  }>("/issues/:id/work-products", async (request, reply) => {
    const workProduct = await db.issueWorkProduct.create({
      data: {
        issueId: request.params.id,
        agentSlug: request.body.agentSlug,
        type: request.body.type,
        title: request.body.title,
        content: request.body.content,
        filePath: request.body.filePath,
      },
    });
    return { workProduct };
  });
}
