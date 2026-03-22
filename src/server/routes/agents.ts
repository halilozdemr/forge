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

    // Check if company requires approval for new agents
    const company = await db.company.findUnique({ where: { id: companyId } });
    if (!company) return reply.code(404).send({ error: "Company not found" });

    if (company.requireApprovalForNewAgents) {
      const approval = await db.approval.create({
        data: {
          companyId,
          type: "hire_agent",
          status: "pending",
          requestedBy: "user",
          metadata: JSON.stringify({
            slug,
            name,
            role: role || name,
            modelProvider: modelProvider || "claude-cli",
            model,
            reportsTo: reportsTo || null,
            permissions: permissions || {},
            heartbeatCron: heartbeatCron || null,
          }),
        },
      });

      return reply.code(202).send({
        message: "Agent hire request submitted for approval",
        approvalId: approval.id,
      });
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
        permissions: JSON.stringify(permissions || {}),
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
    Body: { companyId: string; status?: string; model?: string; heartbeatCron?: string | null; changeNote?: string };
  }>("/agents/:slug", async (request, reply) => {
    const { slug } = request.params;
    const { companyId, status, changeNote, ...updates } = request.body;

    if (!companyId) return reply.code(400).send({ error: "companyId required" });

    const currentAgent = await db.agent.findUnique({
      where: { companyId_slug: { companyId, slug } },
    });

    if (!currentAgent) return reply.code(404).send({ error: "Agent not found" });

    // Handle status transitions separately
    if (status) {
      const result = await transitionAgent(db, companyId, slug, status as any);
      if (!result.success) {
        return reply.code(400).send({ error: result.error });
      }
    }

    // Apply other updates and create revision if needed
    if (Object.keys(updates).length > 0) {
      // Create revision snapshot of current state BEFORE applying updates
      const lastRevision = await db.agentConfigRevision.findFirst({
        where: { agentId: currentAgent.id },
        orderBy: { revision: "desc" },
      });

      const nextRevision = (lastRevision?.revision ?? 0) + 1;

      // Prepare snapshot config
      const snapshot = {
        name: currentAgent.name,
        role: currentAgent.role,
        modelProvider: currentAgent.modelProvider,
        model: currentAgent.model,
        promptFile: currentAgent.promptFile,
        reportsTo: currentAgent.reportsTo,
        permissions: currentAgent.permissions,
        adapterConfig: currentAgent.adapterConfig,
        heartbeatCron: currentAgent.heartbeatCron,
        maxSessionRuns: currentAgent.maxSessionRuns,
        maxSessionTokens: currentAgent.maxSessionTokens,
        maxSessionAgeHours: currentAgent.maxSessionAgeHours,
      };

      await db.agentConfigRevision.create({
        data: {
          agentId: currentAgent.id,
          revision: nextRevision,
          config: JSON.stringify(snapshot),
          changeNote: changeNote || null,
        },
      });

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

  // GET /v1/agents/:slug/revisions
  server.get<{ Params: { slug: string }; Querystring: { companyId: string } }>(
    "/agents/:slug/revisions",
    async (request, reply) => {
      const { slug } = request.params;
      const { companyId } = request.query;
      if (!companyId) return reply.code(400).send({ error: "companyId required" });

      const agent = await db.agent.findUnique({
        where: { companyId_slug: { companyId, slug } },
      });
      if (!agent) return reply.code(404).send({ error: "Agent not found" });

      const revisions = await db.agentConfigRevision.findMany({
        where: { agentId: agent.id },
        orderBy: { revision: "desc" },
      });

      return { revisions };
    }
  );

  // PUT /v1/agents/:slug/rollback
  server.put<{
    Params: { slug: string };
    Body: { companyId: string; revision: number };
  }>("/agents/:slug/rollback", async (request, reply) => {
    const { slug } = request.params;
    const { companyId, revision } = request.body;

    if (!companyId || !revision) {
      return reply.code(400).send({ error: "companyId and revision are required" });
    }

    const agent = await db.agent.findUnique({
      where: { companyId_slug: { companyId, slug } },
    });
    if (!agent) return reply.code(404).send({ error: "Agent not found" });

    const targetRevision = await db.agentConfigRevision.findUnique({
      where: { agentId_revision: { agentId: agent.id, revision } },
    });

    if (!targetRevision) {
      return reply.code(404).send({ error: `Revision ${revision} not found` });
    }

    const config = JSON.parse(targetRevision.config);

    // Create a revision of the current state before rolling back
    const lastRevision = await db.agentConfigRevision.findFirst({
      where: { agentId: agent.id },
      orderBy: { revision: "desc" },
    });

    const nextRevision = (lastRevision?.revision ?? 0) + 1;
    const currentSnapshot = {
      name: agent.name,
      role: agent.role,
      modelProvider: agent.modelProvider,
      model: agent.model,
      promptFile: agent.promptFile,
      reportsTo: agent.reportsTo,
      permissions: agent.permissions,
      adapterConfig: agent.adapterConfig,
      heartbeatCron: agent.heartbeatCron,
      maxSessionRuns: agent.maxSessionRuns,
      maxSessionTokens: agent.maxSessionTokens,
      maxSessionAgeHours: agent.maxSessionAgeHours,
    };

    await db.agentConfigRevision.create({
      data: {
        agentId: agent.id,
        revision: nextRevision,
        config: JSON.stringify(currentSnapshot),
        changeNote: `Rollback to revision ${revision}`,
      },
    });

    const updatedAgent = await db.agent.update({
      where: { id: agent.id },
      data: config,
    });

    return { agent: updatedAgent, message: `Rolled back to revision ${revision}` };
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
