import { getDb } from "../db/client.js";
import { createChildLogger } from "../utils/logger.js";
import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const log = createChildLogger("sync");

let isRunning = false;
let pollingTimer: NodeJS.Timeout | null = null;
let cloudUrl: string | null = null;
let token: string | null = null;

export async function startSyncWorker(): Promise<void> {
  if (isRunning) return;

  cloudUrl = process.env.FORGE_CLOUD_URL || null;
  if (!cloudUrl) {
    try {
      const creds = JSON.parse(readFileSync(join(homedir(), ".forge", "credentials.json"), "utf8"));
      if (creds.cloudUrl) cloudUrl = creds.cloudUrl;
      if (creds.token) token = creds.token;
    } catch {}
  }

  if (!cloudUrl || !token) {
    log.debug("No Forge Cloud URL or token found. Sync worker skipping.");
    return;
  }

  isRunning = true;
  log.info(`Sync worker started targeting ${cloudUrl}`);

  pollingTimer = setInterval(async () => {
    let readyEvents: any[] = [];
    try {
      const db = getDb();
      const events = await db.syncOutbox.findMany({
        where: {
          OR: [
            { status: "pending" },
            { status: "failed", attempts: { lt: 5 } }
          ]
        },
        take: 50,
        orderBy: { createdAt: "asc" }
      });

      if (events.length === 0) return;

      const now = Date.now();
      readyEvents = events.filter(e => {
        if (e.status === "pending") return true;
        if (!e.lastAttemptAt) return true;
        const backoffMs = Math.pow(2, e.attempts) * 5000;
        return (now - e.lastAttemptAt.getTime()) >= backoffMs;
      });

      if (readyEvents.length === 0) return;

      const payload = {
        events: readyEvents.map(e => ({
          id: e.id,
          eventType: e.eventType,
          occurredAt: e.createdAt.toISOString(),
          data: JSON.parse(e.payload)
        }))
      };

      const res = await fetch(`${cloudUrl}/sync/events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        await db.syncOutbox.updateMany({
          where: { id: { in: readyEvents.map(e => e.id) } },
          data: { status: "sent", sentAt: new Date() }
        });
      } else {
        throw new Error(`Cloud returned ${res.status}`);
      }
    } catch (e) {
      log.error({ err: (e as Error).message }, "Sync worker failed to send batch");
      if (readyEvents.length > 0) {
        try {
          const db = getDb();
          await db.syncOutbox.updateMany({
            where: { id: { in: readyEvents.map(e => e.id) } },
            data: { 
              status: "failed", 
              attempts: { increment: 1 }, 
              lastAttemptAt: new Date() 
            }
          });
        } catch (updateErr) {
          log.error({ err: (updateErr as Error).message }, "Failed to update attempt counts");
        }
      }
    }
  }, 5000);
}

export function addSyncEvent(eventType: string, data: Record<string, unknown>) {
  const db = getDb();
  db.syncOutbox.create({
    data: {
      eventType,
      payload: JSON.stringify(data)
    }
  }).catch(() => {});
}

export async function stopSyncWorker() {
    if (pollingTimer) {
        clearInterval(pollingTimer);
    }
    isRunning = false;
}
