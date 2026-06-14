import type { ForgeEvent } from "../../../events/emitter.js";
import type {
  StatusResponse,
  WorkflowSummary,
  WorkflowDetail,
  ApprovalSummary,
  ApprovalDetail,
  LogLine,
} from "../types.js";
import { shortId, nowTime, sortWorkflows } from "./format.js";

export type LogDescriptor = Omit<LogLine, "ts" | "repeat">;

// ── HTTP helpers ────────────────────────────────────────────────────────────

export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return (await res.json()) as T;
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const errObj = data as { error?: string } | null;
    throw new Error(errObj?.error ?? `HTTP ${res.status}`);
  }
  return data as T;
}

export interface IntakeResult {
  issueId: string;
  pipelineRunId: string;
  status: string;
  entryAgentSlug: string;
  queuedStepKeys: string[];
}

// ── Backend client bound to a base URL ──────────────────────────────────────

export class ConsoleClient {
  constructor(private readonly baseUrl: string) {}

  async resolveCompanyId(): Promise<string | null> {
    const ctx = await fetchJson<{ companyId: string | null }>(`${this.baseUrl}/v1/context`);
    return ctx.companyId ?? null;
  }

  async getStatus(companyId: string | null): Promise<StatusResponse> {
    const cq = companyId ? `?companyId=${encodeURIComponent(companyId)}` : "";
    return fetchJson<StatusResponse>(`${this.baseUrl}/v1/status${cq}`);
  }

  async getWorkflows(companyId: string | null): Promise<WorkflowSummary[]> {
    const cq = companyId ? `&companyId=${encodeURIComponent(companyId)}` : "";
    const res = await fetchJson<{ workflows: WorkflowSummary[] }>(
      `${this.baseUrl}/v1/workflows?limit=50${cq}`,
    );
    return sortWorkflows(res.workflows ?? []);
  }

  async getApprovals(companyId: string): Promise<ApprovalSummary[]> {
    const res = await fetchJson<{ approvals: ApprovalSummary[] }>(
      `${this.baseUrl}/v1/approvals/inbox?status=pending&companyId=${encodeURIComponent(companyId)}`,
    );
    return res.approvals ?? [];
  }

  async getWorkflowDetail(id: string): Promise<WorkflowDetail> {
    const res = await fetchJson<{ workflow: WorkflowDetail }>(`${this.baseUrl}/v1/workflows/${id}`);
    return res.workflow;
  }

  async getApprovalDetail(id: string): Promise<ApprovalDetail> {
    const res = await fetchJson<{ approval: ApprovalDetail }>(`${this.baseUrl}/v1/approvals/${id}`);
    return res.approval;
  }

  async submitIntake(body: {
    type: string;
    title: string;
    executionMode: string;
  }): Promise<IntakeResult> {
    return postJson<IntakeResult>(`${this.baseUrl}/v1/intake/requests`, {
      source: "cli",
      requestedBy: "console",
      ...body,
    });
  }

  async decideApproval(detail: ApprovalDetail, decision: "approve" | "reject"): Promise<void> {
    if (detail.actionMode === "harness-decision") {
      const workflowId = detail.workflow?.id;
      const sprintNumber = detail.workflow?.sprintNumber;
      if (!workflowId || sprintNumber == null) {
        throw new Error("Approval detail is missing workflow sprint context.");
      }
      await postJson(`${this.baseUrl}/v1/pipelines/${workflowId}/sprints/${sprintNumber}/decide`, {
        action: decision === "approve" ? "approve_continue" : "reject_and_retry",
        actorId: "console",
      });
      return;
    }
    if (detail.actionMode === "approval-route") {
      await postJson(`${this.baseUrl}/v1/approvals/${detail.id}/${decision}`, {});
      return;
    }
    throw new Error("This approval does not support actions from the console yet.");
  }
}

// ── Event stream parsing ────────────────────────────────────────────────────

function isLowSignalHeartbeat(line: string): boolean {
  const text = line.toLowerCase();
  return (
    text.includes("heartbeat tick")
    || text.includes("nothing to do")
    || text.includes("idle heartbeat")
    || text.includes("polling")
  );
}

export function parseEvent(raw: Buffer | string): ForgeEvent | null {
  try {
    const parsed = JSON.parse(raw.toString()) as ForgeEvent;
    if (!parsed || typeof (parsed as { type?: unknown }).type !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function describeEvent(event: ForgeEvent): LogDescriptor {
  switch (event.type) {
    case "heartbeat.log":
      return {
        text: `@${event.agentSlug} ${event.line}`,
        level: /error|failed|exception/i.test(event.line) ? "error" : /warn|retry|blocked/i.test(event.line) ? "warn" : "info",
        category: "HEARTBT",
        lowSignal: isLowSignalHeartbeat(event.line),
        sourceType: event.type,
      };
    case "issue.updated":
      return {
        text: `issue ${shortId(event.issueId)} -> ${event.status}`,
        level: /failed|blocked|cancelled/i.test(event.status) ? "warn" : "info",
        category: "ISSUE",
        lowSignal: false,
        sourceType: event.type,
      };
    case "queue.job.started":
      return {
        text: `started ${shortId(event.jobId)} @${event.agentSlug}`,
        level: "info",
        category: "QUEUE",
        lowSignal: false,
        sourceType: event.type,
      };
    case "queue.job.completed":
      return {
        text: `completed ${shortId(event.jobId)} ${event.success ? "ok" : "FAILED"}`,
        level: event.success ? "info" : "error",
        category: "QUEUE",
        lowSignal: false,
        sourceType: event.type,
      };
    case "agent.status.changed":
      return {
        text: `${event.agentSlug} -> ${event.status}`,
        level: /paused|terminated|failed/i.test(event.status) ? "warn" : "info",
        category: "AGENT",
        lowSignal: false,
        sourceType: event.type,
      };
    case "budget.threshold":
      return {
        text: `${event.scope} threshold ${event.percent}%`,
        level: event.percent >= 100 ? "error" : "warn",
        category: "BUDGET",
        lowSignal: false,
        sourceType: event.type,
      };
    default:
      return {
        text: "event received",
        level: "info",
        category: "EVENT",
        lowSignal: false,
        sourceType: "unknown",
      };
  }
}

/**
 * Append a log entry to a capped buffer, collapsing consecutive duplicates into
 * a repeat counter. Returns a new array (suitable for React state updates).
 */
export function appendLog(logs: LogLine[], entry: LogDescriptor): LogLine[] {
  const last = logs[logs.length - 1];
  if (
    last
    && last.text === entry.text
    && last.level === entry.level
    && last.category === entry.category
    && last.lowSignal === entry.lowSignal
    && last.sourceType === entry.sourceType
  ) {
    const next = logs.slice();
    next[next.length - 1] = { ...last, repeat: last.repeat + 1 };
    return next;
  }
  const next = [...logs, { ts: nowTime(), repeat: 1, ...entry }];
  if (next.length > 300) next.shift();
  return next;
}
