import type { FastifyInstance } from "fastify";
import { getDb } from "../../db/client.js";

export async function exportRoutes(fastify: FastifyInstance): Promise<void> {
  const db = getDb();

  fastify.get<{ Querystring: { companyId: string } }>("/export", async (req, reply) => {
    const { companyId } = req.query;
    if (!companyId) return reply.status(400).send({ error: "companyId is required" });

    const company = await db.company.findUnique({
      where: { id: companyId },
      include: {
        agents: true,
        budgetPolicies: true,
        secrets: true,
        goals: true,
      },
    });

    if (!company) return reply.status(404).send({ error: "Company not found" });

    // Redact secrets
    const redactedSecrets = company.secrets.map(s => ({
      ...s,
      value: "", // Don't export secret values
    }));

    const projects = await db.project.findMany({ where: { companyId } });
    const projectIds = projects.map(p => p.id);

    const issues = await db.issue.findMany({
      where: { projectId: { in: projectIds } },
      include: {
        comments: true,
        workProducts: true,
        issueLabels: {
          include: { label: true }
        }
      }
    });

    const sprints = await db.sprint.findMany({ where: { projectId: { in: projectIds } } });
    const memoryEntries = await db.memoryEntry.findMany({ where: { companyId } });
    const activityLogs = await db.activityLog.findMany({ where: { companyId } });
    const labels = await db.label.findMany({ where: { companyId } });

    return reply.send({
      company: {
        ...company,
        secrets: redactedSecrets,
      },
      projects,
      issues,
      sprints,
      memoryEntries,
      activityLogs,
      labels,
    });
  });
}
