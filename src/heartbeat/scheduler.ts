import { getDb } from "../db/client.js";
import { createChildLogger } from "../utils/logger.js";
import { runHeartbeatForAgent } from "./handlers.js";
import parser from "cron-parser";

const log = createChildLogger("heartbeat:scheduler");

let isRunning = false;
let pollingTimer: NodeJS.Timeout | null = null;

export async function startHeartbeatScheduler(): Promise<void> {
  if (isRunning) return;
  isRunning = true;

  // Sync DB schedules first
  await syncHeartbeatJobs();

  // Poll ScheduledJobs every 30s
  pollingTimer = setInterval(async () => {
    try {
      const db = getDb();
      const now = new Date();
      
      const jobs = await db.scheduledJob.findMany({
        where: { enabled: true, nextRunAt: { lte: now } }
      });

      for (const job of jobs) {
        log.info({ agentSlug: job.agentSlug, companyId: job.companyId }, "Heartbeat tick");
        
        runHeartbeatForAgent({ agentSlug: job.agentSlug, companyId: job.companyId }).catch(e => {
          log.error({ err: e.message }, "Heartbeat logic failed");
        });

        const interval = parser.parseExpression(job.cronExpression);
        await db.scheduledJob.update({
          where: { id: job.id },
          data: {
            lastRunAt: now,
            nextRunAt: interval.next().toDate()
          }
        });
      }
    } catch (e) {
      log.error({ err: (e as Error).message }, "Heartbeat scheduler poll error");
    }
  }, 30_000);

  log.info("Heartbeat scheduler started");
}

export async function stopHeartbeatScheduler(): Promise<void> {
  if (isRunning) {
    if (pollingTimer) clearInterval(pollingTimer);
    isRunning = false;
  }
}

export async function syncHeartbeatJobs(): Promise<void> {
  const db = getDb();
  const agents = await db.agent.findMany({
    where: { heartbeatCron: { not: null }, status: { not: "terminated" } },
    select: { slug: true, companyId: true, heartbeatCron: true },
  });

  for (const agent of agents) {
    const jobKey = `heartbeat:${agent.companyId}:${agent.slug}`;
    const interval = parser.parseExpression(agent.heartbeatCron!);
    
    await db.scheduledJob.upsert({
      where: { jobKey },
      update: {
        cronExpression: agent.heartbeatCron!,
        enabled: true,
      },
      create: {
        jobKey,
        companyId: agent.companyId,
        agentSlug: agent.slug,
        cronExpression: agent.heartbeatCron!,
        nextRunAt: interval.next().toDate()
      }
    });
    log.debug({ agentSlug: agent.slug, cron: agent.heartbeatCron }, "Heartbeat synchronized");
  }

  const activeKeys = agents.map(a => `heartbeat:${a.companyId}:${a.slug}`);
  await db.scheduledJob.updateMany({
    where: { jobKey: { notIn: activeKeys } },
    data: { enabled: false }
  });

  log.info(`Heartbeat scheduler: ${agents.length} agents registered`);
}

export function getHeartbeatQueue(): any {
  return { add: async () => {}, removeRepeatableByKey: async () => {} };
}
