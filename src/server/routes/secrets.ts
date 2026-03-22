import type { FastifyInstance } from "fastify";
import { getDb } from "../../db/client.js";
import { encrypt } from "../../utils/crypto.js";

export async function secretRoutes(server: FastifyInstance) {
  const db = getDb();

  // POST /v1/secrets (create/upsert)
  server.post<{
    Body: {
      companyId: string;
      name: string;
      value: string;
      description?: string;
    };
  }>("/secrets", async (request, reply) => {
    const { companyId, name, value, description } = request.body;

    if (!companyId || !name || !value) {
      return reply.code(400).send({ error: "companyId, name, and value are required" });
    }

    const encryptedValue = encrypt(value);

    const secret = await db.companySecret.upsert({
      where: { companyId_name: { companyId, name } },
      update: {
        value: encryptedValue,
        description: description || undefined,
      },
      create: {
        companyId,
        name,
        value: encryptedValue,
        description,
      },
    });

    await db.activityLog.create({
      data: {
        companyId,
        actor: "user",
        action: "secret.set",
        resource: `secret:${name}`,
      },
    });

    // Don't return the encrypted value
    const { value: _, ...safeSecret } = secret;
    return { secret: safeSecret };
  });

  // GET /v1/secrets?companyId=xxx (list)
  server.get<{ Querystring: { companyId: string } }>("/secrets", async (request, reply) => {
    const { companyId } = request.query;

    if (!companyId) {
      return reply.code(400).send({ error: "companyId required" });
    }

    const secrets = await db.companySecret.findMany({
      where: { companyId },
      select: {
        id: true,
        companyId: true,
        name: true,
        description: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { name: "asc" },
    });

    return { secrets };
  });

  // DELETE /v1/secrets/:name?companyId=xxx
  server.delete<{
    Params: { name: string };
    Querystring: { companyId: string };
  }>("/secrets/:name", async (request, reply) => {
    const { name } = request.params;
    const { companyId } = request.query;

    if (!companyId) {
      return reply.code(400).send({ error: "companyId required" });
    }

    try {
      await db.companySecret.delete({
        where: { companyId_name: { companyId, name } },
      });

      await db.activityLog.create({
        data: {
          companyId,
          actor: "user",
          action: "secret.delete",
          resource: `secret:${name}`,
        },
      });

      return { message: `Secret "${name}" deleted` };
    } catch (error) {
      return reply.code(404).send({ error: "Secret not found" });
    }
  });
}
