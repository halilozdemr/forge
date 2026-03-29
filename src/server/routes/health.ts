import type { FastifyInstance } from "fastify";
import { getDb } from "../../db/client.js";
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

    const workerHealthy = isWorkerRunning();

    const allHealthy = dbHealthy && workerHealthy;
    const anyHealthy = dbHealthy || workerHealthy;

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
        worker: workerHealthy,
      },
    };
  });
}
