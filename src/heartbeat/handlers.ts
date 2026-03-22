import { createChildLogger } from "../utils/logger.js";
import { getDb } from "../db/client.js";
import { enqueueAgentJob } from "../bridge/queue.js";
import { addSyncEvent } from "../sync/worker.js";
import { emit } from "../events/emitter.js";


const log = createChildLogger("heartbeat:handlers");

interface HeartbeatContext {
  agentSlug: string;
  companyId: string;
}

export async function runHeartbeatForAgent(ctx: HeartbeatContext): Promise<string> {
  const { agentSlug, companyId } = ctx;
  const db = getDb();

  // Record heartbeat run start
  const run = await db.heartbeatRun.create({
    data: {
      agentSlug,
      companyId,
      status: "triggered",
    },
  });

  try {
    let result: string;

    switch (agentSlug) {
      case "scrum-master":
        result = await handleScrumMasterHeartbeat(companyId);
        break;
      case "ceo":
        result = await handleCeoHeartbeat(companyId);
        break;
      case "pm":
        result = await handlePmHeartbeat(companyId);
        break;
      default:
        result = await handleGenericAgentHeartbeat(ctx);
    }

    await db.heartbeatRun.update({
      where: { id: run.id },
      data: { status: "completed", result, completedAt: new Date() },
    });
    addSyncEvent('heartbeat.completed', { companyId, agentSlug, result });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.error({ agentSlug, companyId, error }, "Heartbeat handler failed");
    await db.heartbeatRun.update({
      where: { id: run.id },
      data: { status: "failed", result: error, completedAt: new Date() },
    });
    addSyncEvent('heartbeat.completed', { companyId, agentSlug, result: error, status: "failed" });
  }

  return run.id;
}

/**
 * Scrum Master: check for completed sprints needing retrospective, stale in_progress issues.
 */
async function handleScrumMasterHeartbeat(companyId: string): Promise<string> {
  const db = getDb();
  const actions: string[] = [];

  // Find completed sprints without a retrospective memory entry
  const completedSprints = await db.sprint.findMany({
    where: {
      project: { companyId },
      status: "completed",
    },
    include: { project: true },
    take: 5,
  });

  for (const sprint of completedSprints) {
    const retroExists = await db.memoryEntry.findFirst({
      where: {
        companyId,
        type: "retrospective",
        source: `sprint:${sprint.id}`,
      },
    });

    if (!retroExists) {
      // Queue a retrospective task for scrum-master
      const agent = await db.agent.findFirst({ where: { companyId, slug: "scrum-master" } });
      if (agent) {
        await enqueueAgentJob({
          companyId,
          agentSlug: "scrum-master",
          agentId: agent.id,
          input: `Sprint #${sprint.number} (${sprint.goal}) is complete. Write a retrospective summary and save key learnings.`,
          issueId: undefined,
        });
        actions.push(`queued retrospective for sprint #${sprint.number}`);
      }
    }
  }

  // Find issues in_progress for >24h with no update
  const staleIssues = await db.issue.findMany({
    where: {
      project: { companyId },
      status: "in_progress",
      updatedAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
    take: 10,
  });

  if (staleIssues.length > 0) {
    actions.push(`found ${staleIssues.length} stale in_progress issues`);
    log.warn({ companyId, count: staleIssues.length }, "Stale issues detected by scrum-master heartbeat");
    emit({ type: "heartbeat.log", agentSlug: "scrum-master", line: `Found ${staleIssues.length} stale issues.` });
  }

  return actions.length > 0 ? actions.join("; ") : "no action needed";
}

/**
 * CEO: check for unassigned open issues, flag blockers.
 */
async function handleCeoHeartbeat(companyId: string): Promise<string> {
  const db = getDb();
  const actions: string[] = [];

  const unassignedOpen = await db.issue.count({
    where: {
      project: { companyId },
      status: "open",
      assignedAgentId: null,
    },
  });

  if (unassignedOpen > 0) {
    actions.push(`${unassignedOpen} unassigned open issues`);
    log.warn({ companyId, unassignedOpen }, "CEO heartbeat: unassigned open issues");
    emit({ type: "heartbeat.log", agentSlug: "ceo", line: `Found ${unassignedOpen} unassigned open issues.` });
  }

  const escalatedIssues = await db.issue.count({
    where: { project: { companyId }, status: "escalated" },
  });

  if (escalatedIssues > 0) {
    actions.push(`${escalatedIssues} escalated issues need attention`);
  }

  return actions.length > 0 ? actions.join("; ") : "no action needed";
}

/**
 * PM: check for open issues that haven't been added to any sprint.
 */
async function handlePmHeartbeat(companyId: string): Promise<string> {
  const db = getDb();

  const backlogCount = await db.issue.count({
    where: {
      project: { companyId },
      status: "open",
      sprintId: null,
    },
  });

  if (backlogCount > 0) {
    log.info({ companyId, backlogCount }, "PM heartbeat: backlog items pending sprint assignment");
    emit({ type: "heartbeat.log", agentSlug: "pm", line: `Found ${backlogCount} backlog items pending sprint assignment.` });
    return `${backlogCount} backlog items not in any sprint`;
  }

  return "backlog clear";
}

/**
 * Generic: check for assigned-but-idle issues for this agent.
 */
async function handleGenericAgentHeartbeat(ctx: HeartbeatContext): Promise<string> {
  const { agentSlug, companyId } = ctx;
  const db = getDb();

  const agent = await db.agent.findFirst({ where: { companyId, slug: agentSlug } });
  if (!agent) return "agent not found";

  const pendingIssues = await db.issue.findMany({
    where: {
      project: { companyId },
      assignedAgentId: agent.id,
      status: "open",
    },
    take: 5,
  });

  if (pendingIssues.length > 0) {
    for (const issue of pendingIssues) {
      await enqueueAgentJob({
        companyId,
        agentSlug,
        agentId: agent.id,
        input: issue.description ?? issue.title,
        issueId: issue.id,
      });
    }
    return `queued ${pendingIssues.length} pending issues`;
  }

  return "no pending work";
}
