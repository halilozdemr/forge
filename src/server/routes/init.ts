import { FastifyInstance } from "fastify";
import { getDb } from "../../db/client.js";
import { join } from "path";
import { readFileSync, existsSync } from "fs";
import { seedDatabase } from "../../db/seed.js";
import { syncHeartbeatJobs } from "../../heartbeat/scheduler.js";

export async function initRoutes(fastify: FastifyInstance) {
  fastify.post("/init", async (req, reply) => {
    const rcPath = join(process.cwd(), ".forge", "config.json");
    if (!existsSync(rcPath)) {
      return reply.code(400).send({ error: "No .forge/config.json found. Run 'forge init' first." });
    }

    try {
      const configStr = readFileSync(rcPath, "utf-8");
      const config = JSON.parse(configStr);

      const db = getDb();
      
      const { companyId } = await seedDatabase(db, {
        companyName: config.company?.name ?? "My Forge",
        companySlug: config.company?.slug ?? "my-forge",
        projectName: config.project?.name ?? "my-project",
        projectPath: config.project?.path ?? process.cwd(),
        stack: config.project?.stack ?? "unknown",
      });

      // Sync heartbeat schedules for the newly seeded agents
      await syncHeartbeatJobs();

      return reply.send({ success: true, companyId });
    } catch (err: any) {
      req.log.error({ err }, "Init synchronization failed");
      return reply.code(500).send({ error: err.message });
    }
  });
}
