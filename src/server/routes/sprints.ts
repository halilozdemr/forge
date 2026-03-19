import type { FastifyInstance } from "fastify";
import { getDb } from "../../db/client.js";

export async function sprintRoutes(server: FastifyInstance) {
  const db = getDb();

  // GET /v1/sprints?projectId=xxx
  server.get<{ Querystring: { projectId?: string } }>("/sprints", async (request) => {
    const { projectId } = request.query;
    const sprints = await db.sprint.findMany({
      where: projectId ? { projectId } : undefined,
      orderBy: { number: "desc" },
      include: { _count: { select: { issues: true } } },
    });
    return { sprints };
  });

  // GET /v1/sprints/:id
  server.get<{ Params: { id: string } }>("/sprints/:id", async (request, reply) => {
    const sprint = await db.sprint.findUnique({
      where: { id: request.params.id },
      include: {
        issues: {
          orderBy: { createdAt: "asc" },
          include: { assignedAgent: { select: { slug: true, name: true } } },
        },
      },
    });

    if (!sprint) return reply.code(404).send({ error: "Sprint not found" });
    return { sprint };
  });

  // POST /v1/sprints
  server.post<{
    Body: { projectId: string; number: number; goal: string };
  }>("/sprints", async (request) => {
    const sprint = await db.sprint.create({
      data: {
        ...request.body,
        status: "planning",
      },
    });
    return { sprint };
  });

  // PUT /v1/sprints/:id
  server.put<{
    Params: { id: string };
    Body: { status?: string; goal?: string };
  }>("/sprints/:id", async (request, reply) => {
    const existing = await db.sprint.findUnique({ where: { id: request.params.id } });
    if (!existing) return reply.code(404).send({ error: "Sprint not found" });

    const data: Record<string, unknown> = {};
    if (request.body.status) data.status = request.body.status;
    if (request.body.goal) data.goal = request.body.goal;
    if (request.body.status === "active" && !existing.startedAt) data.startedAt = new Date();
    if (request.body.status === "completed") data.closedAt = new Date();

    const sprint = await db.sprint.update({
      where: { id: request.params.id },
      data,
    });
    return { sprint };
  });
}
