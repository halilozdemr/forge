import type { FastifyInstance } from "fastify";
import { getDb } from "../../db/client.js";

export async function healthRoutes(server: FastifyInstance) {
  server.get("/health", async () => {
    let dbStatus = "disconnected";
    try {
      await getDb().$queryRaw`SELECT 1`;
      dbStatus = "connected";
    } catch {
      dbStatus = "error";
    }

    return {
      status: "ok",
      version: "3.0.0",
      db: dbStatus,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  });
}
