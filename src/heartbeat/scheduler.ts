import { Queue, Worker, QueueEvents } from "bullmq";
import type { ConnectionOptions } from "bullmq";
import { createChildLogger } from "../utils/logger.js";
import { getDb } from "../db/client.js";
import { runHeartbeatForAgent } from "./handlers.js";

const log = createChildLogger("heartbeat:scheduler");

const HEARTBEAT_QUEUE = "forge-heartbeats";

let heartbeatQueue: Queue | null = null;
let heartbeatWorker: Worker | null = null;

export async function startHeartbeatScheduler(connection: ConnectionOptions): Promise<void> {
  heartbeatQueue = new Queue(HEARTBEAT_QUEUE, { connection });

  // Register repeatable jobs for all agents that have a heartbeatCron
  await syncHeartbeatJobs(connection);

  // Worker processes heartbeat jobs
  heartbeatWorker = new Worker(
    HEARTBEAT_QUEUE,
    async (job) => {
      const { agentSlug, companyId } = job.data as { agentSlug: string; companyId: string };
      log.info({ agentSlug, companyId }, "Heartbeat tick");
      await runHeartbeatForAgent({ agentSlug, companyId });
    },
    {
      connection,
      concurrency: 2,
    }
  );

  heartbeatWorker.on("failed", (job, err) => {
    log.error({ jobId: job?.id, err }, "Heartbeat job failed");
  });

  log.info("Heartbeat scheduler started");
}

export async function stopHeartbeatScheduler(): Promise<void> {
  if (heartbeatWorker) {
    await heartbeatWorker.close();
    heartbeatWorker = null;
  }
  if (heartbeatQueue) {
    await heartbeatQueue.close();
    heartbeatQueue = null;
  }
}

/**
 * Syncs DB heartbeatCron schedules → BullMQ repeatable jobs.
 * Called on startup and when an agent's cron is updated.
 */
export async function syncHeartbeatJobs(connection: ConnectionOptions): Promise<void> {
  if (!heartbeatQueue) {
    heartbeatQueue = new Queue(HEARTBEAT_QUEUE, { connection });
  }

  const db = getDb();
  const agents = await db.agent.findMany({
    where: { heartbeatCron: { not: null }, status: { not: "terminated" } },
    select: { slug: true, companyId: true, heartbeatCron: true },
  });

  // Remove all existing repeatable jobs first (clean slate on restart)
  const repeatableJobs = await heartbeatQueue.getRepeatableJobs();
  for (const job of repeatableJobs) {
    await heartbeatQueue.removeRepeatableByKey(job.key);
  }

  // Register current schedules
  for (const agent of agents) {
    const jobId = `heartbeat:${agent.companyId}:${agent.slug}`;
    await heartbeatQueue.add(
      "heartbeat",
      { agentSlug: agent.slug, companyId: agent.companyId },
      {
        repeat: { pattern: agent.heartbeatCron! },
        jobId, // prevents duplicate repeatable jobs
      }
    );
    log.debug({ agentSlug: agent.slug, cron: agent.heartbeatCron }, "Heartbeat scheduled");
  }

  log.info(`Heartbeat scheduler: ${agents.length} agents registered`);
}

export function getHeartbeatQueue(): Queue {
  if (!heartbeatQueue) throw new Error("Heartbeat queue not initialized");
  return heartbeatQueue;
}
