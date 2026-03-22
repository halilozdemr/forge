import { FastifyInstance } from "fastify";
import { emit, ForgeEvent } from "../../events/emitter.js";
import { createChildLogger } from "../../utils/logger.js";

const log = createChildLogger("routes:events");

export async function eventRoutes(server: FastifyInstance) {
  server.post("/events/emit", async (request, reply) => {
    const event = request.body as ForgeEvent;
    
    if (!event || !event.type) {
      return reply.code(400).send({ error: "Invalid event payload" });
    }

    log.debug({ type: event.type }, "Manual event emission triggered via API");
    emit(event);
    
    return { success: true };
  });
}
