import { WebSocket } from "ws";

export type ForgeEvent =
  | { type: "agent.status.changed"; agentSlug: string; status: string }
  | { type: "issue.updated"; issueId: string; status: string }
  | { type: "heartbeat.log"; agentSlug: string; line: string }
  | { type: "queue.job.started"; jobId: string; agentSlug: string }
  | { type: "queue.job.completed"; jobId: string; success: boolean }
  | { type: "budget.threshold"; scope: string; percent: number };

const clients: Set<WebSocket> = new Set();

/**
 * Register a new WebSocket client
 */
export function registerClient(socket: WebSocket) {
  clients.add(socket);
}

/**
 * Unregister a WebSocket client
 */
export function unregisterClient(socket: WebSocket) {
  clients.delete(socket);
}

/**
 * Emit an event to all connected WebSocket clients
 */
export function emit(event: ForgeEvent): void {
  const message = JSON.stringify(event);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(event));
    }
  }
}
