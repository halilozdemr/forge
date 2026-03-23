import type { FastifyInstance } from "fastify";
import { getDb } from "../../db/client.js";
import { transitionAgent } from "../../agents/lifecycle.js";
import { buildHierarchy, formatHierarchy, getEscalationChain } from "../../agents/hierarchy.js";
import { isSupportedModelProvider, isValidModel } from "../../agents/validation.js";

const EDITABLE_STATUSES = new Set(["idle", "active", "paused", "terminated"]);

function requireNonEmptyString(value: unknown, field: string): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof value !== "string" || value.trim().length === 0) {
    return { ok: false, error: `${field} must be a non-empty string` };
  }
  return { ok: true, value: value.trim() };
}

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
    Body: {
      companyId: string;
      status?: string;
      name?: string;
      role?: string;
      modelProvider?: string;
      model?: string;
      promptFile?: string | null;
      reportsTo?: string | null;
      permissions?: Record<string, boolean>;
      maxConcurrent?: number;
      heartbeatCron?: string | null;
      clientConfig?: Record<string, unknown>;
      changeNote?: string;
    };
  }>("/agents/:slug", async (request, reply) => {
    const { slug } = request.params;
    const { companyId, status, changeNote } = request.body;

    if (typeof companyId !== "string" || companyId.trim().length === 0) {
      return reply.code(400).send({ error: "companyId required" });
    }
    const normalizedCompanyId = companyId.trim();

    const currentAgent = await db.agent.findUnique({
      where: { companyId_slug: { companyId: normalizedCompanyId, slug } },
    });

    if (!currentAgent) return reply.code(404).send({ error: "Agent not found" });

    // Handle status transitions separately
    if (status) {
      if (!EDITABLE_STATUSES.has(status)) {
        return reply.code(400).send({ error: `Invalid status: ${status}` });
      }
      const result = await transitionAgent(db, normalizedCompanyId, slug, status as any);
      if (!result.success) {
        return reply.code(400).send({ error: result.error });
      }
    }

    const updates: Record<string, unknown> = {};

    if (request.body.name !== undefined) {
      const parsed = requireNonEmptyString(request.body.name, "name");
      if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
      updates.name = parsed.value;
    }

    if (request.body.role !== undefined) {
      const parsed = requireNonEmptyString(request.body.role, "role");
      if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
      updates.role = parsed.value;
    }

    if (request.body.modelProvider !== undefined) {
      const parsed = requireNonEmptyString(request.body.modelProvider, "modelProvider");
      if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
      if (!isSupportedModelProvider(parsed.value)) {
        return reply.code(400).send({ error: `Unsupported modelProvider: ${parsed.value}` });
      }
      updates.modelProvider = parsed.value;
    }

    if (request.body.model !== undefined) {
      const parsed = requireNonEmptyString(request.body.model, "model");
      if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
      if (!isValidModel(parsed.value)) {
        return reply.code(400).send({ error: `Invalid model format: ${parsed.value}` });
      }
      updates.model = parsed.value;
    }

    if (request.body.promptFile !== undefined) {
      if (request.body.promptFile === null) {
        updates.promptFile = null;
      } else {
        const parsed = requireNonEmptyString(request.body.promptFile, "promptFile");
        if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
        updates.promptFile = parsed.value;
      }
    }

    if (request.body.reportsTo !== undefined) {
      if (request.body.reportsTo === null) {
        updates.reportsTo = null;
      } else {
        const parsed = requireNonEmptyString(request.body.reportsTo, "reportsTo");
        if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
        updates.reportsTo = parsed.value;
      }
    }

    if (request.body.heartbeatCron !== undefined) {
      if (request.body.heartbeatCron === null) {
        updates.heartbeatCron = null;
      } else {
        const parsed = requireNonEmptyString(request.body.heartbeatCron, "heartbeatCron");
        if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
        updates.heartbeatCron = parsed.value;
      }
    }

    if (request.body.permissions !== undefined) {
      const permissions = request.body.permissions;
      const isObject = typeof permissions === "object" && permissions !== null && !Array.isArray(permissions);
      if (!isObject) {
        return reply.code(400).send({ error: "permissions must be an object of boolean values" });
      }
      for (const [key, value] of Object.entries(permissions)) {
        if (typeof value !== "boolean") {
          return reply.code(400).send({ error: `permissions.${key} must be boolean` });
        }
      }
      updates.permissions = JSON.stringify(permissions);
    }

    if (request.body.maxConcurrent !== undefined) {
      if (!Number.isInteger(request.body.maxConcurrent) || request.body.maxConcurrent < 1) {
        return reply.code(400).send({ error: "maxConcurrent must be an integer >= 1" });
      }
      updates.maxConcurrent = request.body.maxConcurrent;
    }

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
        maxConcurrent: currentAgent.maxConcurrent,
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
        where: { companyId_slug: { companyId: normalizedCompanyId, slug } },
        data: updates,
      });

      await db.activityLog.create({
        data: {
          companyId: normalizedCompanyId,
          actor: "user",
          action: "agent.updated",
          resource: `agent:${slug}`,
          metadata: JSON.stringify({
            fields: Object.keys(updates),
            changeNote: changeNote || null,
          }),
        },
      });
    }

    const agent = await db.agent.findUnique({
      where: { companyId_slug: { companyId: normalizedCompanyId, slug } },
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
      maxConcurrent: agent.maxConcurrent,
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

  // DELETE /v1/agents/:slug (fire/delete)
  server.delete<{ Params: { slug: string }; Querystring: { companyId: string } }>("/agents/:slug", async (request, reply) => {
    const { slug } = request.params;
    const { companyId } = request.query;

    if (!companyId) return reply.code(400).send({ error: "companyId required" });

    const agent = await db.agent.findUnique({
      where: { companyId_slug: { companyId, slug } },
    });
    if (!agent) return reply.code(404).send({ error: "Agent not found" });

    await db.agent.delete({ where: { id: agent.id } });

    await db.activityLog.create({
      data: { companyId, actor: "user", action: "agent.deleted", resource: `agent:${slug}` },
    });

    return { message: `Agent "${slug}" deleted` };
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
