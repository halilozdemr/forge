import type { FastifyInstance } from "fastify";
import { getDb } from "../../db/client.js";
import { getRedisStatus } from "../../bridge/queue.js";
import { isWorkerRunning } from "../../bridge/worker.js";

export async function healthRoutes(server: FastifyInstance) {
  server.get("/health", async () => {
    let dbHealthy = false;
    try {
      await getDb().$queryRaw`SELECT 1`;
      dbHealthy = true;
    } catch {
      dbHealthy = false;
    }

    const redisHealthy = await getRedisStatus();
    const workerHealthy = isWorkerRunning();

    const allHealthy = dbHealthy && redisHealthy && workerHealthy;
    const anyHealthy = dbHealthy || redisHealthy || workerHealthy;

    let status: "healthy" | "degraded" | "down" = "healthy";
    if (!allHealthy) {
      status = anyHealthy ? "degraded" : "down";
    }

    return {
      status,
      version: "3.0.0",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      components: {
        db: dbHealthy,
        redis: redisHealthy,
        worker: workerHealthy,
      },
    };
  });
}
