import type { FastifyInstance } from "fastify";
import { getQueue } from "../../bridge/queue.js";
import { getDb } from "../../db/client.js";

export async function queueRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /v1/queue/status/:jobId — BullMQ job status
  fastify.get<{ Params: { jobId: string } }>("/queue/status/:jobId", async (req, reply) => {
    const q = getQueue({} as any); // queue already initialized
    const job = await q.getJob(req.params.jobId);
    if (!job) {
      return reply.status(404).send({ error: "Job not found" });
    }
    const state = await job.getState();
    return reply.send({ jobId: job.id, state, data: job.data, progress: job.progress });
  });

  // GET /v1/queue/result/:jobId — BullMQ job result
  fastify.get<{ Params: { jobId: string } }>("/queue/result/:jobId", async (req, reply) => {
    const q = getQueue({} as any);
    const job = await q.getJob(req.params.jobId);
    if (!job) {
      return reply.status(404).send({ error: "Job not found" });
    }
    const state = await job.getState();
    return reply.send({
      jobId: job.id,
      state,
      returnvalue: job.returnvalue,
      failedReason: job.failedReason,
    });
  });

  // GET /v1/queue/jobs — list recent jobs from DB mirror
  fastify.get<{ Querystring: { companyId?: string; status?: string } }>("/queue/jobs", async (req, reply) => {
    const db = getDb();
    const where: Record<string, unknown> = {};
    if (req.query.companyId) where.companyId = req.query.companyId;
    if (req.query.status) where.status = req.query.status;

    const jobs = await db.queueJob.findMany({
      where,
      orderBy: { queuedAt: "desc" },
      take: 50,
    });
    return reply.send({ jobs });
  });
}
