import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '../utils/prisma';

export const syncRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.post('/events', {
    onRequest: [fastify.authenticate],
    schema: {
      body: z.object({
        events: z.array(z.object({
          id: z.string(),
          eventType: z.string(),
          occurredAt: z.string().optional(),
          data: z.any()
        }))
      })
    }
  }, async (request, reply) => {
    const { events } = request.body;
    const userId = request.user.userId;
    
    // Find or create default instance for user
    let instance = await prisma.forgeInstance.findFirst({
      where: { userId, name: 'default' }
    });
    if (!instance) {
      instance = await prisma.forgeInstance.create({
        data: { userId, name: 'default' }
      });
    }
    const instanceId = instance.id;

    let processed = 0;
    
    for (const ev of events) {
      // Log raw event
      await prisma.syncEvent.create({
        data: {
          id: ev.id,
          instanceId,
          eventType: ev.eventType,
          payload: ev.data,
          receivedAt: new Date()
        }
      });
      
      const data = ev.data as any;
      
      try {
        switch (ev.eventType) {
          case 'agent.updated':
          case 'agent.created':
            await prisma.cloudAgent.upsert({
              where: { instanceId_agentId: { instanceId, agentId: data.id || data.agentId } },
              update: {
                slug: data.slug,
                name: data.name,
                role: data.role,
                status: data.status,
              },
              create: {
                instanceId,
                agentId: data.id || data.agentId,
                slug: data.slug,
                name: data.name,
                role: data.role,
                status: data.status,
              }
            });
            break;
            
          case 'issue.created':
          case 'issue.updated':
            await prisma.cloudIssue.upsert({
              where: { instanceId_issueId: { instanceId, issueId: data.id || data.issueId } },
              update: {
                title: data.title,
                status: data.status,
                priority: data.priority || 'normal',
                type: data.type || 'feature',
                assignedAgentSlug: data.assignedAgentSlug,
                sprintId: data.sprintId,
              },
              create: {
                instanceId,
                issueId: data.id || data.issueId,
                title: data.title,
                status: data.status,
                priority: data.priority || 'normal',
                type: data.type || 'feature',
                assignedAgentSlug: data.assignedAgentSlug,
                sprintId: data.sprintId,
              }
            });
            break;
            
          case 'sprint.created':
          case 'sprint.updated':
            await prisma.cloudSprint.upsert({
              where: { instanceId_sprintId: { instanceId, sprintId: data.id || data.sprintId } },
              update: {
                number: data.number,
                goal: data.goal,
                status: data.status,
                startedAt: data.startedAt ? new Date(data.startedAt) : null,
                closedAt: data.closedAt ? new Date(data.closedAt) : null,
              },
              create: {
                instanceId,
                sprintId: data.id || data.sprintId,
                number: data.number,
                goal: data.goal,
                status: data.status,
                startedAt: data.startedAt ? new Date(data.startedAt) : null,
                closedAt: data.closedAt ? new Date(data.closedAt) : null,
              }
            });
            break;
            
          case 'budget.updated':
            await prisma.cloudBudget.upsert({
              where: { instanceId_month: { instanceId, month: data.month } },
              update: {
                totalUsd: data.totalUsd
              },
              create: {
                instanceId,
                month: data.month,
                totalUsd: data.totalUsd
              }
            });
            break;
            
          case 'heartbeat.completed':
            // Handled inherently by raw event log
            break;
        }
        processed++;
      } catch (err) {
        request.log.error({ err, event: ev }, 'Failed to process sync event');
      }
    }

    await prisma.forgeInstance.update({
      where: { id: instanceId },
      data: { lastSyncAt: new Date() }
    });

    return reply.send({ received: events.length, processed });
  });
};
