import type { FastifyInstance } from "fastify";
import { getDb } from "../../db/client.js";
import { createChildLogger } from "../../utils/logger.js";
import { transitionAgent } from "../../agents/lifecycle.js";

const log = createChildLogger("approvals-api");

export async function approvalRoutes(server: FastifyInstance) {
  const db = getDb();

  // GET /v1/approvals?companyId=&status=pending
  server.get<{ Querystring: { companyId: string; status?: string } }>("/approvals", async (request, reply) => {
    const { companyId, status } = request.query;

    if (!companyId) return reply.code(400).send({ error: "companyId required" });

    const approvals = await db.approval.findMany({
      where: {
        companyId,
        status: status || "pending",
      },
      orderBy: { requestedAt: "desc" },
    });

    return { approvals };
  });

  // POST /v1/approvals/:id/approve
  server.post<{ Params: { id: string } }>("/approvals/:id/approve", async (request, reply) => {
    const { id } = request.params;

    const approval = await db.approval.findUnique({ where: { id } });

    if (!approval) return reply.code(404).send({ error: "Approval not found" });
    if (approval.status !== "pending") return reply.code(400).send({ error: `Approval is already ${approval.status}` });

    const metadata = JSON.parse(approval.metadata);

    try {
      if (approval.type === "hire_agent") {
        // Create the agent
        const agent = await db.agent.create({
          data: {
            companyId: approval.companyId,
            slug: metadata.slug,
            name: metadata.name,
            role: metadata.role || metadata.name,
            modelProvider: metadata.modelProvider || "claude-cli",
            model: metadata.model,
            reportsTo: metadata.reportsTo || null,
            permissions: JSON.stringify(metadata.permissions || {}),
            heartbeatCron: metadata.heartbeatCron || null,
            status: "idle",
          },
        });

        await db.activityLog.create({
          data: { 
            companyId: approval.companyId, 
            actor: "user", 
            action: "agent.hired", 
            resource: `agent:${metadata.slug}`,
            metadata: JSON.stringify({ approvalId: id })
          },
        });

        log.info({ approvalId: id, agentSlug: metadata.slug }, "Agent hire approved and created");
      } else if (approval.type === "budget_override") {
        // Unpause the agent
        const agentSlug = metadata.agentSlug;
        if (agentSlug) {
          const result = await transitionAgent(db, approval.companyId, agentSlug, "idle");
          if (!result.success) {
            return reply.code(400).send({ error: `Failed to unpause agent: ${result.error}` });
          }
          log.info({ approvalId: id, agentSlug }, "Budget override approved, agent unpaused");
        }
      }

      // Update approval status
      await db.approval.update({
        where: { id },
        data: {
          status: "approved",
          reviewedAt: new Date(),
        },
      });

      return { message: "Approved successfully" };
    } catch (error: any) {
      log.error({ approvalId: id, error: error.message }, "Failed to process approval");
      return reply.code(500).send({ error: `Failed to process approval: ${error.message}` });
    }
  });

  // POST /v1/approvals/:id/reject
  server.post<{ Params: { id: string }; Body: { reason?: string } }>("/approvals/:id/reject", async (request, reply) => {
    const { id } = request.params;
    const { reason } = request.body;

    const approval = await db.approval.findUnique({ where: { id } });

    if (!approval) return reply.code(404).send({ error: "Approval not found" });
    if (approval.status !== "pending") return reply.code(400).send({ error: `Approval is already ${approval.status}` });

    await db.approval.update({
      where: { id },
      data: {
        status: "rejected",
        reviewedAt: new Date(),
      },
    });

    log.info({ approvalId: id, reason }, "Approval rejected");

    return { message: "Rejected successfully" };
  });
}
