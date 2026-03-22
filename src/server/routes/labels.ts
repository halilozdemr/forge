import type { FastifyInstance } from "fastify";
import { getDb } from "../../db/client.js";

export async function labelRoutes(server: FastifyInstance) {
  const db = getDb();

  // GET /v1/labels?companyId=xxx
  server.get<{ Querystring: { companyId: string } }>("/labels", async (request, reply) => {
    const { companyId } = request.query;
    if (!companyId) return reply.code(400).send({ error: "companyId required" });

    const labels = await db.label.findMany({
      where: { companyId },
      orderBy: { name: "asc" },
    });
    return { labels };
  });

  // POST /v1/labels
  server.post<{
    Body: { companyId: string; name: string; color?: string };
  }>("/labels", async (request, reply) => {
    const { companyId, name, color } = request.body;

    if (!companyId || !name) {
      return reply.code(400).send({ error: "companyId and name are required" });
    }

    try {
      const label = await db.label.upsert({
        where: { companyId_name: { companyId, name } },
        update: { color: color || undefined },
        create: { companyId, name, color: color || undefined },
      });

      return { label };
    } catch (error) {
      return reply.code(500).send({ error: "Failed to create/update label" });
    }
  });

  // DELETE /v1/labels/:id
  server.delete<{ Params: { id: string } }>("/labels/:id", async (request, reply) => {
    const { id } = request.params;

    try {
      await db.label.delete({ where: { id } });
      return { message: "Label deleted" };
    } catch (error) {
      return reply.code(404).send({ error: "Label not found" });
    }
  });

  // POST /v1/issues/:id/labels
  server.post<{
    Params: { id: string };
    Body: { companyId: string; labelNames: string[] };
  }>("/issues/:id/labels", async (request, reply) => {
    const { id: issueId } = request.params;
    const { companyId, labelNames } = request.body;

    if (!companyId || !labelNames) {
      return reply.code(400).send({ error: "companyId and labelNames are required" });
    }

    // 1. Resolve labels by name for this company
    const labels = await db.label.findMany({
      where: {
        companyId,
        name: { in: labelNames },
      },
    });

    // 2. Clear existing labels for this issue and sync new ones
    await db.$transaction([
      db.issueLabel.deleteMany({ where: { issueId } }),
      db.issueLabel.createMany({
        data: labels.map((l) => ({ issueId, labelId: l.id })),
      }),
    ]);

    return { message: "Issue labels synced", labels };
  });

  // GET /v1/issues/:id/labels
  server.get<{ Params: { id: string } }>("/issues/:id/labels", async (request, reply) => {
    const { id: issueId } = request.params;

    const issueLabels = await db.issueLabel.findMany({
      where: { issueId },
      include: { label: true },
    });

    return { labels: issueLabels.map((il) => il.label) };
  });
}
