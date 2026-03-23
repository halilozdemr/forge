import { getDb } from "../db/client.js";
import { randomUUID } from "crypto";
import { createChildLogger } from "../utils/logger.js";

const log = createChildLogger("session");

export interface SessionState {
  sessionId: string;
  tokenCount: number;
  runCount: number;
  lastUsedAt: Date;
}

/**
 * Finds existing or creates a new session for an agent and optionally an issue.
 */
export async function resolveSession(agentId: string, issueId?: string): Promise<string> {
  const db = getDb();

  if (issueId) {
    const taskSession = await db.agentTaskSession.findUnique({
      where: { agentId_issueId: { agentId, issueId } },
    });
    if (taskSession && !taskSession.closedAt) {
      return taskSession.sessionId;
    }
  }

  const runtimeState = await db.agentRuntimeState.findUnique({
    where: { agentId },
  });

  if (runtimeState?.sessionId) {
    const agent = await db.agent.findUnique({ where: { id: agentId } });
    if (agent && !shouldRotate(runtimeState as any, agent)) {
      if (issueId) {
        await db.agentTaskSession.upsert({
          where: { agentId_issueId: { agentId, issueId } },
          create: { agentId, issueId, sessionId: runtimeState.sessionId },
          update: { sessionId: runtimeState.sessionId, closedAt: null },
        });
      }
      return runtimeState.sessionId;
    } else if (agent) {
       const { sessionId } = await rotateSession(agentId, issueId);
       return sessionId;
    }
  }

  // Create new session if none exists or rotation forced
  const newSessionId = `sess_${randomUUID().substring(0, 8)}`;
  await db.$transaction([
    db.agentRuntimeState.upsert({
      where: { agentId },
      create: { agentId, sessionId: newSessionId, runCount: 0, tokenCount: 0 },
      update: { sessionId: newSessionId, runCount: 0, tokenCount: 0 },
    }),
    ...(issueId ? [
      db.agentTaskSession.upsert({
        where: { agentId_issueId: { agentId, issueId } },
        create: { agentId, issueId, sessionId: newSessionId },
        update: { sessionId: newSessionId, closedAt: null },
      })
    ] : []),
  ]);

  return newSessionId;
}

/**
 * Checks if a session should be rotated based on agent limits.
 */
export function shouldRotate(state: SessionState, agent: any): boolean {
  if (!state.sessionId) return true;

  const now = new Date();
  const ageHours = (now.getTime() - new Date(state.lastUsedAt).getTime()) / (1000 * 60 * 60);

  if (state.runCount >= agent.maxSessionRuns) return true;
  if (state.tokenCount >= agent.maxSessionTokens) return true;
  if (ageHours >= agent.maxSessionAgeHours) return true;

  return false;
}

/**
 * Rotates a session, generating a new ID and returning a handoff note.
 */
export async function rotateSession(agentId: string, issueId?: string): Promise<{ sessionId: string; handoffNote: string }> {
  const db = getDb();
  const newSessionId = `sess_${randomUUID().substring(0, 8)}`;
  
  const oldState = await db.agentRuntimeState.findUnique({ where: { agentId } });
  const handoffNote = oldState?.sessionId 
    ? `\n\n[SESSION_ROTATED] Previous session (${oldState.sessionId}) reached limits. Starting fresh context.`
    : "";

  await db.$transaction([
    db.agentRuntimeState.update({
      where: { agentId },
      data: { sessionId: newSessionId, runCount: 0, tokenCount: 0 },
    }),
    ...(issueId ? [
      db.agentTaskSession.update({
        where: { agentId_issueId: { agentId, issueId } },
        data: { sessionId: newSessionId },
      })
    ] : []),
  ]);

  log.info({ agentId, oldSession: oldState?.sessionId, newSession: newSessionId }, "Session rotated");
  return { sessionId: newSessionId, handoffNote };
}

/**
 * Updates usage statistics for a session.
 */
export async function updateSessionUsage(agentId: string, issueId: string | undefined, tokens: { input: number; output: number }): Promise<void> {
  const db = getDb();
  const totalTokens = tokens.input + tokens.output;

  await db.agentRuntimeState.update({
    where: { agentId },
    data: {
      runCount: { increment: 1 },
      tokenCount: { increment: totalTokens },
    },
  });

  if (issueId) {
    await db.agentTaskSession.update({
      where: { agentId_issueId: { agentId, issueId } },
      data: {
        tokenCount: { increment: totalTokens },
      },
    });
  }
}
