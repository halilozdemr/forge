import type { FastifyInstance } from "fastify";
import { getDb } from "../../db/client.js";

export async function budgetRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /v1/budget/policies?companyId=
  fastify.get<{ Querystring: { companyId: string } }>("/budget/policies", async (req, reply) => {
    const { companyId } = req.query;
    if (!companyId) return reply.status(400).send({ error: "companyId is required" });

    const db = getDb();
    const policies = await db.budgetPolicy.findMany({ where: { companyId } });
    return reply.send({ policies });
  });

  // POST /v1/budget/policies
  fastify.post<{
    Body: {
      companyId: string;
      scope?: string;
      scopeId?: string;
      monthlyLimitUsd: number;
      softLimitPct?: number;
      hardLimitPct?: number;
      action?: string;
    };
  }>("/budget/policies", async (req, reply) => {
    const { companyId, scope = "company", scopeId, monthlyLimitUsd, softLimitPct = 80, hardLimitPct = 100, action = "pause" } = req.body;
    if (!companyId || monthlyLimitUsd == null) {
      return reply.status(400).send({ error: "companyId and monthlyLimitUsd are required" });
    }

    const db = getDb();
    // Use findFirst + upsert pattern to handle nullable scopeId in compound unique key
    const existing = await db.budgetPolicy.findFirst({
      where: { companyId, scope, scopeId: scopeId ?? null },
    });

    const policy = existing
      ? await db.budgetPolicy.update({
          where: { id: existing.id },
          data: { monthlyLimitUsd, softLimitPct, hardLimitPct, action },
        })
      : await db.budgetPolicy.create({
          data: { companyId, scope, scopeId: scopeId ?? null, monthlyLimitUsd, softLimitPct, hardLimitPct, action },
        });
    return reply.status(201).send({ policy });
  });

  // GET /v1/budget/usage?companyId=
  fastify.get<{ Querystring: { companyId: string } }>("/budget/usage", async (req, reply) => {
    const { companyId } = req.query;
    if (!companyId) return reply.status(400).send({ error: "companyId is required" });

    const db = getDb();
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const [policies, costAgg] = await Promise.all([
      db.budgetPolicy.findMany({ where: { companyId } }),
      db.costEvent.aggregate({
        where: { companyId, createdAt: { gte: startOfMonth } },
        _sum: { costUsd: true, inputTokens: true, outputTokens: true },
      }),
    ]);

    const usage = {
      totalUsd: costAgg._sum.costUsd ?? 0,
      inputTokens: costAgg._sum.inputTokens ?? 0,
      outputTokens: costAgg._sum.outputTokens ?? 0,
      totalTokens: (costAgg._sum.inputTokens ?? 0) + (costAgg._sum.outputTokens ?? 0),
      month: startOfMonth.toISOString().slice(0, 7),
    };

    return reply.send({ policies, usage });
  });

  // GET /v1/budget/report?companyId=&month=yyyy-mm
  fastify.get<{ Querystring: { companyId: string; month?: string } }>("/budget/report", async (req, reply) => {
    const { companyId, month } = req.query;
    if (!companyId) return reply.status(400).send({ error: "companyId is required" });

    const db = getDb();
    let startDate: Date;
    let endDate: Date;

    if (month) {
      const [year, mon] = month.split("-").map(Number);
      startDate = new Date(year, mon - 1, 1);
      endDate = new Date(year, mon, 1);
    } else {
      startDate = new Date();
      startDate.setDate(1);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 1);
    }

    const [events, agg] = await Promise.all([
      db.costEvent.findMany({
        where: { companyId, createdAt: { gte: startDate, lt: endDate } },
        orderBy: { createdAt: "desc" },
        take: 500,
      }),
      db.costEvent.aggregate({
        where: { companyId, createdAt: { gte: startDate, lt: endDate } },
        _sum: { costUsd: true, inputTokens: true, outputTokens: true },
        _count: true,
      }),
    ]);

    const summary = {
      totalUsd: agg._sum.costUsd ?? 0,
      totalTokens: (agg._sum.inputTokens ?? 0) + (agg._sum.outputTokens ?? 0),
      eventCount: agg._count,
      month: startDate.toISOString().slice(0, 7),
    };

    return reply.send({ events, summary });
  });

  // POST /v1/heartbeat/trigger — manual heartbeat trigger
  fastify.post<{
    Body: { agentSlug: string; companyId: string };
  }>("/heartbeat/trigger", async (req, reply) => {
    const { agentSlug, companyId } = req.body;
    if (!agentSlug || !companyId) {
      return reply.status(400).send({ error: "agentSlug and companyId are required" });
    }

    const db = getDb();
    const agent = await db.agent.findFirst({ where: { companyId, slug: agentSlug } });
    if (!agent) return reply.status(404).send({ error: `Agent ${agentSlug} not found` });

    const { runHeartbeatForAgent } = await import("../../heartbeat/handlers.js");

    // Kick off async — don't await so we return immediately
    runHeartbeatForAgent({ agentSlug, companyId }).catch(() => {});

    // Find the run record we just created (or create a placeholder)
    const run = await db.heartbeatRun.findFirst({
      where: { agentSlug, companyId },
      orderBy: { triggeredAt: "desc" },
    });

    return reply.status(202).send({ run });
  });

  // GET /v1/heartbeat/runs?companyId=&agentSlug=
  fastify.get<{ Querystring: { companyId: string; agentSlug?: string } }>("/heartbeat/runs", async (req, reply) => {
    const { companyId, agentSlug } = req.query;
    if (!companyId) return reply.status(400).send({ error: "companyId is required" });

    const db = getDb();
    const where: Record<string, unknown> = { companyId };
    if (agentSlug) where.agentSlug = agentSlug;

    const runs = await db.heartbeatRun.findMany({
      where,
      orderBy: { triggeredAt: "desc" },
      take: 50,
    });
    return reply.send({ runs });
  });
}
