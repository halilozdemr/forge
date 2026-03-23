import type { FastifyInstance } from "fastify";
import { getDb } from "../../db/client.js";
import { loadConfig } from "../../utils/config.js";

export async function statusRoutes(server: FastifyInstance) {
  // Context endpoint: prefer the current project's configured path for WebUI auto-discovery.
  server.get("/context", async () => {
    const db = getDb();
    const config = loadConfig();

    const projectForCurrentPath = await db.project.findFirst({
      where: { path: config.projectPath },
      orderBy: { createdAt: "desc" },
    });

    if (projectForCurrentPath) {
      const company = await db.company.findUnique({ where: { id: projectForCurrentPath.companyId } });
      return {
        companyId: company?.id ?? null,
        companyName: company?.name ?? null,
        projectId: projectForCurrentPath.id,
        projectName: projectForCurrentPath.name,
      };
    }

    const company = await db.company.findFirst({ orderBy: { createdAt: "asc" } });
    if (!company) {
      return { companyId: null, companyName: null, projectId: null, projectName: null };
    }

    const project = await db.project.findFirst({ where: { companyId: company.id }, orderBy: { createdAt: "asc" } });
    return {
      companyId: company.id,
      companyName: company.name,
      projectId: project?.id ?? null,
      projectName: project?.name ?? null,
    };
  });

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
