import type { FastifyInstance } from "fastify";
import { getDb } from "../../db/client.js";
import { transitionAgent } from "../../agents/lifecycle.js";
import { buildHierarchy, formatHierarchy, getEscalationChain } from "../../agents/hierarchy.js";

export async function agentRoutes(server: FastifyInstance) {
  const db = getDb();

  // GET /v1/agents?companyId=xxx
  server.get<{ Querystring: { companyId: string } }>("/agents", async (request) => {
    const { companyId } = request.query;
    const agents = await db.agent.findMany({
      where: companyId ? { companyId } : undefined,
      orderBy: { slug: "asc" },
    });
    return { agents };
  });

  // GET /v1/agents/:slug?companyId=xxx
  server.get<{ Params: { slug: string }; Querystring: { companyId: string } }>("/agents/:slug", async (request, reply) => {
    const { slug } = request.params;
    const { companyId } = request.query;

    if (!companyId) return reply.code(400).send({ error: "companyId required" });

    const agent = await db.agent.findUnique({
      where: { companyId_slug: { companyId, slug } },
    });

    if (!agent) return reply.code(404).send({ error: "Agent not found" });

    // Get hierarchy info
    const allAgents = await db.agent.findMany({ where: { companyId } });
    const chain = getEscalationChain(allAgents, slug);

    return { agent, escalationChain: chain.map((a) => a.slug) };
  });

  // POST /v1/agents (create/hire)
  server.post<{
    Body: {
      companyId: string;
      slug: string;
      name: string;
      role: string;
      modelProvider?: string;
      model: string;
      reportsTo?: string;
      permissions?: Record<string, boolean>;
      heartbeatCron?: string;
    };
  }>("/agents", async (request, reply) => {
    const { companyId, slug, name, role, modelProvider, model, reportsTo, permissions, heartbeatCron } = request.body;

    if (!companyId || !slug || !name || !model) {
      return reply.code(400).send({ error: "companyId, slug, name, and model are required" });
    }

    const agent = await db.agent.create({
      data: {
        companyId,
        slug,
        name,
        role: role || name,
        modelProvider: modelProvider || "claude-cli",
        model,
        reportsTo: reportsTo || null,
        permissions: permissions || {},
        heartbeatCron: heartbeatCron || null,
        status: "idle",
      },
    });

    await db.activityLog.create({
      data: { companyId, actor: "user", action: "agent.hired", resource: `agent:${slug}` },
    });

    return { agent };
  });

  // PUT /v1/agents/:slug (update)
  server.put<{
    Params: { slug: string };
    Body: { companyId: string; status?: string; model?: string; heartbeatCron?: string | null };
  }>("/agents/:slug", async (request, reply) => {
    const { slug } = request.params;
    const { companyId, status, ...updates } = request.body;

    if (!companyId) return reply.code(400).send({ error: "companyId required" });

    // Handle status transitions separately
    if (status) {
      const result = await transitionAgent(db, companyId, slug, status as any);
      if (!result.success) {
        return reply.code(400).send({ error: result.error });
      }
    }

    // Apply other updates
    if (Object.keys(updates).length > 0) {
      await db.agent.update({
        where: { companyId_slug: { companyId, slug } },
        data: updates,
      });
    }

    const agent = await db.agent.findUnique({
      where: { companyId_slug: { companyId, slug } },
    });

    return { agent };
  });

  // DELETE /v1/agents/:slug (fire/terminate)
  server.delete<{ Params: { slug: string }; Querystring: { companyId: string } }>("/agents/:slug", async (request, reply) => {
    const { slug } = request.params;
    const { companyId } = request.query;

    if (!companyId) return reply.code(400).send({ error: "companyId required" });

    const result = await transitionAgent(db, companyId, slug, "terminated");
    if (!result.success) {
      return reply.code(400).send({ error: result.error });
    }

    return { message: `Agent "${slug}" terminated` };
  });

  // GET /v1/agents/hierarchy?companyId=xxx
  server.get<{ Querystring: { companyId: string } }>("/agents/hierarchy", async (request) => {
    const { companyId } = request.query;
    const agents = await db.agent.findMany({
      where: companyId ? { companyId } : undefined,
    });
    const tree = buildHierarchy(agents);
    return { hierarchy: formatHierarchy(tree) };
  });
}
