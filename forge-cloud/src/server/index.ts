import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyJwt from '@fastify/jwt';
import fastifyFormbody from '@fastify/formbody';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';

import { config } from '../utils/config';
import { logger } from '../utils/logger';
import { authRoutes } from '../auth';
import { syncRoutes } from '../sync';
import { dashboardRoutes } from '../dashboard';
import { prisma } from '../utils/prisma';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: any;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { userId: string; sessionId: string };
    user: { userId: string; sessionId: string };
  }
}

export const buildServer = async () => {
  const server = Fastify({
    logger: logger as any,
  }).withTypeProvider<ZodTypeProvider>();

  server.setValidatorCompiler(validatorCompiler);
  server.setSerializerCompiler(serializerCompiler);

  await server.register(cors, {
    origin: true
  });

  await server.register(fastifyFormbody);

  await server.register(fastifyJwt, {
    secret: config.JWT_SECRET
  });

  server.decorate('authenticate', async function (request: any, reply: any) {
    try {
      await request.jwtVerify();
      // Check if session still exists and valid
      const session = await prisma.userSession.findUnique({
        where: { id: request.user.sessionId }
      });
      if (!session || session.expiresAt < new Date()) {
        throw new Error('Session expired');
      }
    } catch (err) {
      reply.code(401).send({ error: 'Unauthorized' });
    }
  });

  server.register(authRoutes, { prefix: '/auth' });
  server.register(syncRoutes, { prefix: '/sync' });
  server.register(dashboardRoutes, { prefix: '/dashboard' });

  // Serve Web UI
  const webuiDistPath = path.join(__dirname, '../../webui/dist');
  await server.register(fastifyStatic, {
    root: webuiDistPath,
    prefix: '/',
  });

  // Catch-all for SPA routing
  server.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api') || request.url.startsWith('/auth') || request.url.startsWith('/sync') || request.url.startsWith('/dashboard')) {
      reply.code(404).send({ error: 'Not found' });
    } else {
      reply.sendFile('index.html');
    }
  });

  return server;
};
