import Fastify from "fastify";
import cors from "@fastify/cors";
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

  const address = await server.listen({ port, host });
  log.info(`Server listening on ${address}`);

  return server;
}
