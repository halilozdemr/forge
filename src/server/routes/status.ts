import type { FastifyInstance } from "fastify";
import { getDb } from "../../db/client.js";

export async function statusRoutes(server: FastifyInstance) {
  server.get<{ Querystring: { companyId?: string } }>("/status", async (request) => {
    const db = getDb();
    const { companyId } = request.query;

    let company = null;
    let project = null;

    if (companyId) {
      company = await db.company.findUnique({ where: { id: companyId } });
      project = await db.project.findFirst({ where: { companyId } });
    }

    // Queue stats
    const pendingQueue = await db.queueJob.count({ where: { status: "pending", ...(companyId ? { companyId } : {}) } });
    const runningQueue = await db.queueJob.count({ where: { status: "running", ...(companyId ? { companyId } : {}) } });
    const failedQueue = await db.queueJob.count({ where: { status: "failed", ...(companyId ? { companyId } : {}) } });

    // Agent stats
    const idleAgents = await db.agent.count({ where: { status: "idle", ...(companyId ? { companyId } : {}) } });
    const activeAgents = await db.agent.count({ where: { status: "active", ...(companyId ? { companyId } : {}) } });
    const pausedAgents = await db.agent.count({ where: { status: "paused", ...(companyId ? { companyId } : {}) } });
    const totalAgents = await db.agent.count({ where: { ...(companyId ? { companyId } : {}) } });

    // Heartbeat stats
    const scheduledJobs = await db.scheduledJob.findMany({ 
      where: { enabled: true, ...(companyId ? { companyId } : {}) },
      orderBy: { nextRunAt: "asc" }
    });
    
    let nextRun = null;
    if (scheduledJobs.length > 0) {
      const nextRunMs = scheduledJobs[0].nextRunAt.getTime() - Date.now();
      nextRun = nextRunMs > 0 ? nextRunMs : 0;
    }

    return {
      company,
      project,
      queue: { pending: pendingQueue, running: runningQueue, failed: failedQueue },
      agents: { total: totalAgents, idle: idleAgents, running: activeAgents, paused: pausedAgents },
      heartbeat: {
        scheduledCount: scheduledJobs.length,
        scheduledAgents: scheduledJobs.map(j => j.agentSlug),
        nextRunMs: nextRun
      }
    };
  });
}
