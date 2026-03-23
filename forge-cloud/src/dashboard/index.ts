import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '../utils/prisma';

export const dashboardRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.addHook('onRequest', fastify.authenticate);

  const getInstanceId = async (userId: string) => {
    const instance = await prisma.forgeInstance.findFirst({
      where: { userId, name: 'default' }
    });
    return instance?.id;
  };

  fastify.get('/agents', async (request, reply) => {
    const instanceId = await getInstanceId(request.user.userId);
    if (!instanceId) return { agents: [] };
    const agents = await prisma.cloudAgent.findMany({ where: { instanceId } });
    return { agents };
  });

  fastify.get('/issues', {
    schema: {
      querystring: z.object({
        status: z.string().optional(),
        sprintId: z.string().optional(),
        assignedAgentSlug: z.string().optional(),
        limit: z.string().optional().transform(v => v ? parseInt(v) : 50)
      })
    }
  }, async (request, reply) => {
    const instanceId = await getInstanceId(request.user.userId);
    if (!instanceId) return { issues: [] };
    const { status, sprintId, assignedAgentSlug, limit } = request.query;
    
    const where: any = { instanceId };
    if (status) where.status = status;
    if (sprintId) where.sprintId = sprintId;
    if (assignedAgentSlug) where.assignedAgentSlug = assignedAgentSlug;
    
    const issues = await prisma.cloudIssue.findMany({
      where,
      take: limit as number | undefined,
      orderBy: { updatedAt: 'desc' }
    });
    return { issues };
  });

  fastify.get('/sprints', async (request, reply) => {
    const instanceId = await getInstanceId(request.user.userId);
    if (!instanceId) return { sprints: [] };
    const sprints = await prisma.cloudSprint.findMany({
      where: { instanceId },
      orderBy: { number: 'desc' }
    });
    return { sprints };
  });

  fastify.get('/budget', {
    schema: {
      querystring: z.object({
        month: z.string().optional()
      })
    }
  }, async (request, reply) => {
    const instanceId = await getInstanceId(request.user.userId);
    let month = request.query.month;
    if (!month) {
      const now = new Date();
      month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }

    if (!instanceId) return { month, totalUsd: 0, lastUpdated: new Date() };
    
    const budget = await prisma.cloudBudget.findUnique({
      where: { instanceId_month: { instanceId, month } }
    });
    
    if (!budget) return { month, totalUsd: 0, lastUpdated: new Date() };
    return { month: budget.month, totalUsd: budget.totalUsd, lastUpdated: budget.updatedAt };
  });

  fastify.get('/summary', async (request, reply) => {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const instanceId = await getInstanceId(request.user.userId);
    
    if (!instanceId) {
      return {
        agents: { total: 0, running: 0, idle: 0 },
        issues: { open: 0, inProgress: 0, done: 0 },
        activeSprint: null,
        budget: { month: currentMonth, totalUsd: 0 }
      };
    }
    
    const agents = await prisma.cloudAgent.findMany({ where: { instanceId } });
    const issues = await prisma.cloudIssue.findMany({ where: { instanceId } });
    const activeSprint = await prisma.cloudSprint.findFirst({
      where: { instanceId, status: 'active' },
      orderBy: { number: 'desc' },
      take: 1
    });
    
    const budget = await prisma.cloudBudget.findUnique({
      where: { instanceId_month: { instanceId, month: currentMonth } }
    });

    return {
      agents: {
        total: agents.length,
        running: agents.filter(a => a.status === 'running').length,
        idle: agents.filter(a => a.status === 'idle').length
      },
      issues: {
        open: issues.filter(i => i.status === 'open').length,
        inProgress: issues.filter(i => i.status === 'in_progress').length,
        done: issues.filter(i => i.status === 'done').length
      },
      activeSprint: activeSprint ? { number: activeSprint.number, goal: activeSprint.goal } : null,
      budget: { month: currentMonth, totalUsd: budget?.totalUsd || 0 }
    };
  });
};
