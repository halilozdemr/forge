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
    const { companyId, status } = request.body;

    if (typeof companyId !== "string" || companyId.trim().length === 0) {
      return reply.code(400).send({ error: "companyId required" });
    }
    const normalizedCompanyId = companyId.trim();

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
      updates.permissions = permissions;
    }

    if (request.body.maxConcurrent !== undefined) {
      if (!Number.isInteger(request.body.maxConcurrent) || request.body.maxConcurrent < 1) {
        return reply.code(400).send({ error: "maxConcurrent must be an integer >= 1" });
      }
      updates.maxConcurrent = request.body.maxConcurrent;
    }

    // Apply other updates
    if (Object.keys(updates).length > 0) {
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
          metadata: {
            fields: Object.keys(updates),
            changeNote: request.body.changeNote || null,
          },
        },
      });
    }

    const agent = await db.agent.findUnique({
      where: { companyId_slug: { companyId: normalizedCompanyId, slug } },
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
