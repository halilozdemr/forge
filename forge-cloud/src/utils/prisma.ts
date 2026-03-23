import { PrismaClient } from '@prisma/client';
import { logger } from './logger';

export const prisma = new PrismaClient({
  log: [
    { emit: 'event', level: 'query' },
    { emit: 'event', level: 'info' },
    { emit: 'event', level: 'warn' },
    { emit: 'event', level: 'error' },
  ],
});

prisma.$on('query', (e) => {
  if (process.env.DEBUG?.includes('prisma')) {
    logger.debug({ query: e.query, duration: e.duration });
  }
});
prisma.$on('info', (e) => logger.info(e.message));
prisma.$on('warn', (e) => logger.warn(e.message));
prisma.$on('error', (e) => logger.error(e.message));
