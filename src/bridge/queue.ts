import { Queue } from "bullmq";
import type { ConnectionOptions } from "bullmq";
import { createChildLogger } from "../utils/logger.js";
import { getDb } from "../db/client.js";
import { AgentRegistry } from "../agents/registry.js";

const log = createChildLogger("queue");

export interface AgentJobData {
  companyId: string;
  agentSlug: string;
  agentModel: string;
  modelProvider: string;
  systemPrompt: string;
  input: string;
  permissions: Record<string, boolean>;
  projectPath: string;
  issueId?: string;
  timeoutMs?: number;
  nextAction?: {
    agentSlug: string;
    input: string;
  };
}

let queue: Queue<AgentJobData> | null = null;

export function getQueue(connection: ConnectionOptions): Queue<AgentJobData> {
  if (!queue) {
    queue = new Queue<AgentJobData>("agent-tasks", {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 2000,
        },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
      },
    });
    log.info("Agent task queue initialized");
  }
  return queue;
}

export async function closeQueue(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = null;
  }
}

/**
 * Convenience: look up agent prompt from registry and enqueue a job.
 * Requires queue to be initialized first (after `getQueue()` call in start.ts).
 */
export async function enqueueAgentJob(opts: {
  companyId: string;
  agentSlug: string;
  agentId: string;
  input: string;
  issueId?: string;
  nextAction?: { agentSlug: string; input: string };
}): Promise<string> {
  if (!queue) throw new Error("Queue not initialized — call getQueue() first");

  const db = getDb();
  const agent = await db.agent.findFirst({
    where: { id: opts.agentId },
  });
  if (!agent) throw new Error(`Agent ${opts.agentId} not found`);

  const registry = new AgentRegistry(db);
  const systemPrompt = await registry.resolvePrompt(agent);

  const job = await queue.add("agent-task", {
    companyId: opts.companyId,
    agentSlug: opts.agentSlug,
    agentModel: agent.model,
    modelProvider: agent.modelProvider,
    systemPrompt,
    input: opts.input,
    permissions: (agent.permissions as Record<string, boolean>) ?? {},
    projectPath: process.cwd(),
    issueId: opts.issueId,
    nextAction: opts.nextAction,
  });

  return job.id!;
}
