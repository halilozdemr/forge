import type { PrismaClient } from "@prisma/client";
import { createChildLogger } from "../utils/logger.js";

const log = createChildLogger("lifecycle");

/** Valid agent statuses */
export type AgentStatus = "pending_approval" | "idle" | "active" | "paused" | "terminated";

/** Valid state transitions */
const VALID_TRANSITIONS: Record<AgentStatus, AgentStatus[]> = {
  pending_approval: ["idle", "terminated"],
  idle: ["active", "paused", "terminated"],
  active: ["idle", "paused", "terminated"],
  paused: ["idle", "terminated"],
  terminated: [], // terminal state
};

export function canTransition(from: AgentStatus, to: AgentStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export async function transitionAgent(
  db: PrismaClient,
  companyId: string,
  slug: string,
  newStatus: AgentStatus,
): Promise<{ success: boolean; error?: string }> {
  const agent = await db.agent.findUnique({
    where: { companyId_slug: { companyId, slug } },
  });

  if (!agent) {
    return { success: false, error: `Agent "${slug}" not found` };
  }

  const currentStatus = agent.status as AgentStatus;

  if (!canTransition(currentStatus, newStatus)) {
    return {
      success: false,
      error: `Invalid transition: ${currentStatus} -> ${newStatus}`,
    };
  }

  await db.agent.update({
    where: { companyId_slug: { companyId, slug } },
    data: { status: newStatus },
  });

  log.info({ slug, from: currentStatus, to: newStatus }, "Agent status changed");

  // Log activity
  await db.activityLog.create({
    data: {
      companyId,
      actor: "system",
      action: `agent.${newStatus}`,
      resource: `agent:${slug}`,
      metadata: { from: currentStatus, to: newStatus },
    },
  });

  return { success: true };
}
