import Fastify from "fastify";
import { existsSync } from "fs";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import path from "path";
import { fileURLToPath } from "url";
import { createChildLogger } from "../utils/logger.js";
import { healthRoutes } from "./routes/health.js";
import { completionsRoutes } from "./routes/completions.js";
import { bridgeRoutes } from "./routes/bridge.js";
import { agentRoutes } from "./routes/agents.js";
import { issueRoutes } from "./routes/issues.js";
import { sprintRoutes } from "./routes/sprints.js";
import { queueRoutes } from "./routes/queue.js";
import { budgetRoutes } from "./routes/budget.js";
import { companyRoutes } from "./routes/companies.js";
import { initRoutes } from "./routes/init.js";
import { statusRoutes } from "./routes/status.js";

const log = createChildLogger("server");

export async function createServer(port = 3131, host = "0.0.0.0") {
  const server = Fastify({
    logger: false,
  });

  await server.register(cors, { origin: true });

  // Register routes
  await server.register(healthRoutes);
  await server.register(completionsRoutes);
  await server.register(bridgeRoutes);
  await server.register(agentRoutes, { prefix: "/v1" });
  await server.register(issueRoutes, { prefix: "/v1" });
  await server.register(sprintRoutes, { prefix: "/v1" });
  await server.register(queueRoutes, { prefix: "/v1" });
  await server.register(budgetRoutes, { prefix: "/v1" });
  await server.register(companyRoutes, { prefix: "/v1" });
  await server.register(initRoutes, { prefix: "/v1" });
  await server.register(statusRoutes, { prefix: "/v1" });

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  
  let webuiDistPath = path.join(__dirname, "../../webui/dist");
  if (!existsSync(webuiDistPath)) {
    // Try one more level up for production (dist/src/server -> webui/dist)
    webuiDistPath = path.join(__dirname, "../../../webui/dist");
  }

  log.info(`Serving WebUI from: ${webuiDistPath}`);

  await server.register(fastifyStatic, {
    root: webuiDistPath,
    prefix: "/",
    wildcard: false, // Don't match everything here, we need the fallback below
  });

  // SPA fallback for hash-based router (optional but good practice)
  // Even though it's hash-based, we want to serve index.html for unknown routes
  server.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/v1") || request.url === "/health") {
      reply.code(404).send({ error: "Not Found" });
      return;
    }
    reply.sendFile("index.html");
  });

  const address = await server.listen({ port, host });
  log.info(`Server listening on ${address}`);

  return server;
}
