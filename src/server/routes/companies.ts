import type { FastifyInstance } from "fastify";
import { getDb } from "../../db/client.js";

export async function companyRoutes(fastify: FastifyInstance): Promise<void> {
  const db = getDb();

  // GET /v1/companies
  fastify.get("/companies", async (_req, reply) => {
    const companies = await db.company.findMany({ orderBy: { name: "asc" } });
    return reply.send({ companies });
  });

  // GET /v1/companies/:slug
  fastify.get<{ Params: { slug: string } }>("/companies/:slug", async (req, reply) => {
    const company = await db.company.findUnique({ where: { slug: req.params.slug } });
    if (!company) return reply.status(404).send({ error: "Company not found" });
    return reply.send({ company });
  });

  // POST /v1/companies
  fastify.post<{ Body: { name: string; slug: string } }>("/companies", async (req, reply) => {
    const { name, slug } = req.body;
    if (!name || !slug) return reply.status(400).send({ error: "name and slug are required" });

    const existing = await db.company.findUnique({ where: { slug } });
    if (existing) return reply.status(409).send({ error: `Company slug "${slug}" already exists` });

    const company = await db.company.create({ data: { name, slug } });
    return reply.status(201).send({ company });
  });
}
