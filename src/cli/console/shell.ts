import { emitKeypressEvents } from "readline";
import type { ForgeEvent } from "../../events/emitter.js";
import type {
  ConsoleState,
  ForgeConsoleShellOptions,
  LayoutRegions,
  ApprovalDetail,
  ApprovalSummary,
  WorkflowSummary,
  WorkflowDetail,
  NewTaskFocusField,
  LogLine,
} from "./types.js";
import {
  getLayout,
  visibleLength,
  hr,
  shortId,
  nowTime,
  BOLD, DIM, GREEN, YELLOW, CYAN, R,
} from "./layout.js";
import { renderKeymap } from "./keymap.js";
import { renderOverview } from "./views/overview.js";
import { renderWorkflows, sortWorkflows } from "./views/workflows.js";
import { renderApprovals } from "./views/approvals.js";
import { renderLogs } from "./views/logs.js";
import { renderWorkflowDetail } from "./views/workflow-detail.js";
import { renderApprovalDetail } from "./views/approval-detail.js";
import { renderNewTask } from "./views/new-task.js";

// ── Internal HTTP / WS types ──────────────────────────────────────────────────

interface StatusResponse {
  queue?: { pending?: number; running?: number; failed?: number };
  agents?: { total?: number; idle?: number; running?: number; paused?: number };
  heartbeat?: { scheduledCount?: number; nextRunMs?: number | null };
}

interface WsClient {
  close: () => void;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
}

type LogDescriptor = Omit<LogLine, "ts" | "repeat">;

// ── Helpers ───────────────────────────────────────────────────────────────────

function isLowSignalHeartbeat(line: string): boolean {
  const text = line.toLowerCase();
  return (
    text.includes("heartbeat tick")
    || text.includes("nothing to do")
    || text.includes("idle heartbeat")
    || text.includes("polling")
  );
}

function describeEvent(event: ForgeEvent): LogDescriptor {
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

function parseEvent(raw: Buffer | string): ForgeEvent | null {
  try {
    const parsed = JSON.parse(raw.toString()) as ForgeEvent;
    if (!parsed || typeof (parsed as { type?: unknown }).type !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

function appendLog(state: ConsoleState, entry: LogDescriptor): void {
  const last = state.logs[state.logs.length - 1];
  if (
    last
    && last.text === entry.text
    && last.level === entry.level
    && last.category === entry.category
    && last.lowSignal === entry.lowSignal
    && last.sourceType === entry.sourceType
  ) {
    last.repeat += 1;
    return;
  }
  state.logs.push({ ts: nowTime(), repeat: 1, ...entry });
  if (state.logs.length > 300) state.logs.shift();
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return (await res.json()) as T;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null) as unknown;
  if (!res.ok) {
    const errObj = data as { error?: string } | null;
    throw new Error(errObj?.error ?? `HTTP ${res.status}`);
  }
  return data as T;
}

interface IntakeResult {
  issueId: string;
  pipelineRunId: string;
  status: string;
  entryAgentSlug: string;
  queuedStepKeys: string[];
}

function clampIndex(index: number, length: number): number {
  if (length === 0) return 0;
  return Math.max(0, Math.min(index, length - 1));
}

function resetWorkflowDetail(state: ConsoleState): void {
  state.workflowDetail = null;
  state.workflowDetailLoading = false;
  state.workflowDetailError = null;
}

function resetApprovalDetail(state: ConsoleState): void {
  state.approvalDetail = null;
  state.approvalDetailLoading = false;
  state.approvalDetailError = null;
  state.approvalActionLoading = false;
}

// ── Shell frame renderers ─────────────────────────────────────────────────────

function renderHeader(state: ConsoleState, layout: LayoutRegions, port: number): string {
  const title = `${BOLD}FORGE CONSOLE${R}`;

  // Breadcrumb
  const topLabel = state.nav.topLevel.toUpperCase();
  let breadcrumb = `${CYAN}${topLabel}${R}`;
  if (state.nav.detail) {
    const detailLabel = state.nav.detail.toUpperCase().replace("-", " ");
    breadcrumb += `  ${DIM}›${R}  ${YELLOW}${detailLabel}${R}`;
    if (state.nav.detailId) {
      breadcrumb += `  ${DIM}${shortId(state.nav.detailId)}${R}`;
    }
  }

  const portStr = `${DIM}localhost:${port}${R}`;
  const timeStr = `${DIM}${nowTime()}${R}`;

  const left = ` ${title}  ${breadcrumb}`;
  const right = `${portStr}  ${timeStr} `;

  const gap = layout.width - visibleLength(left) - visibleLength(right);
  return left + " ".repeat(Math.max(1, gap)) + right;
}

function renderStatus(state: ConsoleState): string {
  if (state.shutdownRequested) {
    return ` ${YELLOW}Shutting down runtime…${R}`;
  }

  const wsStatus = state.logsConnected
    ? `${GREEN}●${R} live`
    : `${YELLOW}●${R} connecting`;
  const updated = state.lastUpdatedAt
    ? state.lastUpdatedAt.toLocaleTimeString()
    : "pending";
  let line = ` ${wsStatus}  ${DIM}updated ${updated}${R}`;

  if (state.lastRefreshError) {
    const msg = state.lastRefreshError.slice(0, 80);
    line += `  ${YELLOW}⚠ ${msg}${R}`;
  }

  if (state.flashMessage) {
    const color =
      state.flashTone === "success" ? GREEN :
      state.flashTone === "error" ? YELLOW :
      DIM;
    line += `  ${color}${state.flashMessage}${R}`;
  }

  return line;
}

// ── Main shell function ───────────────────────────────────────────────────────

export async function startForgeConsoleShell(opts: ForgeConsoleShellOptions): Promise<() => void> {
  const state: ConsoleState = {
    nav: {
      topLevel: "workflows",
      detail: null,
      selectedIndex: 0,
      detailId: null,
    },
    newTaskForm: {
      focusField: "type",
      workType: "feature",
      title: "",
      executionMode: "fast",
      submitting: false,
      submitError: null,
    },
    companyId: opts.initialCompanyId ?? null,
    status: null,
    workflows: [],
    approvals: [],
    pendingApprovals: null,
    logs: [],
    logsConnected: false,
    heartbeatFilterEnabled: true,
    logSeverityMode: "all",
    logsPaused: false,
    lastLogEventAt: null,
    lastUpdatedAt: null,
    lastRefreshError: null,
    shutdownRequested: false,
    workflowDetail: null,
    workflowDetailLoading: false,
    workflowDetailError: null,
    approvalDetail: null,
    approvalDetailLoading: false,
    approvalDetailError: null,
    approvalActionLoading: false,
    flashMessage: null,
    flashTone: null,
    detailScrollOffset: 0,
  };

  const baseUrl = `http://localhost:${opts.port}`;
  const wsUrl = `ws://localhost:${opts.port}/ws`;
  const canCaptureKeyboard = Boolean(
    process.stdin.isTTY && process.stdout.isTTY && process.stdin.setRawMode,
  );

  let disposed = false;
  let ws: WsClient | null = null;
  let refreshInFlight = false;
  let refreshTimer: NodeJS.Timeout | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let logRenderTimer: NodeJS.Timeout | null = null;
  let lastFrame = "";

  // ── Render ──────────────────────────────────────────────────────────────────

  const render = () => {
    if (disposed) return;
    const layout = getLayout();
    const lines: string[] = [];

    // Header
    lines.push(renderHeader(state, layout, opts.port));
    lines.push(hr(layout.width));

    // Content — dispatch to active view
    let contentLines: string[];

    try {
      if (state.nav.detail === "new-task") {
        contentLines = renderNewTask(state, layout);
      } else if (state.nav.detail === "workflow-detail") {
        contentLines = renderWorkflowDetail(state, layout);
      } else if (state.nav.detail === "approval-detail") {
        contentLines = renderApprovalDetail(state, layout);
      } else {
        switch (state.nav.topLevel) {
          case "overview":
            contentLines = renderOverview(state, layout);
            break;
          case "workflows":
            contentLines = renderWorkflows(state, layout);
            break;
          case "approvals":
            contentLines = renderApprovals(state, layout);
            break;
          case "logs":
            contentLines = renderLogs(state, layout);
            break;
        }
      }
    } catch (err) {
      contentLines = [
        "",
        `  ${YELLOW}render error — ${String(err).slice(0, layout.width - 20)}${R}`,
      ];
    }

    // Pad / trim content to exactly contentHeight rows
    while (contentLines.length < layout.contentHeight) contentLines.push("");
    lines.push(...contentLines.slice(0, layout.contentHeight));

    // Footer
    lines.push(hr(layout.width));
    lines.push(renderStatus(state));
    lines.push(
      renderKeymap(
        state.nav,
        state.nav.detail === "new-task" ? state.newTaskForm.focusField : undefined,
      ),
    );

    // Cursor-home + overwrite in-place (no full-screen clear).
    // \x1b[H   = move cursor to 1,1 without blanking the screen
    // \x1b[K   = erase from cursor to end of line (clears stale chars on shorter lines)
    // \x1b[J   = erase from cursor to end of screen (clears stale rows on shorter frames)
    const frame = "\x1b[H" + lines.map((l) => l + "\x1b[K").join("\n") + "\n\x1b[J";
    if (frame === lastFrame) return;
    lastFrame = frame;
    process.stdout.write(frame);
  };

  // ── Data refresh ────────────────────────────────────────────────────────────

  const refresh = async () => {
    if (disposed || refreshInFlight) return;
    refreshInFlight = true;
    const selectedWorkflowId =
      state.nav.topLevel === "workflows"
        ? state.workflows[state.nav.selectedIndex]?.id ?? null
        : null;
    const selectedApprovalId =
      state.nav.topLevel === "approvals"
        ? state.approvals[state.nav.selectedIndex]?.id ?? null
        : null;
    try {
      // Resolve companyId on first run
      if (!state.companyId) {
        const ctx = await fetchJson<{ companyId: string | null }>(`${baseUrl}/v1/context`);
        state.companyId = ctx.companyId ?? null;
      }

      const cq = state.companyId ? `companyId=${encodeURIComponent(state.companyId)}` : "";

      // Runtime status
      state.status = await fetchJson<StatusResponse>(
        `${baseUrl}/v1/status${cq ? `?${cq}` : ""}`,
      );

      // Workflow list
      const wfRes = await fetchJson<{ workflows: WorkflowSummary[] }>(
        `${baseUrl}/v1/workflows?limit=50${cq ? `&${cq}` : ""}`,
      );
      state.workflows = sortWorkflows(wfRes.workflows ?? []);
      if (state.nav.topLevel === "workflows" && selectedWorkflowId) {
        const idx = state.workflows.findIndex((wf) => wf.id === selectedWorkflowId);
        state.nav.selectedIndex = idx >= 0 ? idx : clampIndex(state.nav.selectedIndex, state.workflows.length);
      } else if (state.nav.topLevel === "workflows") {
        state.nav.selectedIndex = clampIndex(state.nav.selectedIndex, state.workflows.length);
      }

      // Approvals
      if (state.companyId) {
        const apRes = await fetchJson<{ approvals: ApprovalSummary[] }>(
          `${baseUrl}/v1/approvals/inbox?status=pending&${cq}`,
        );
        state.approvals = apRes.approvals ?? [];
        state.pendingApprovals = state.approvals.length;
        if (state.nav.topLevel === "approvals" && selectedApprovalId) {
          const idx = state.approvals.findIndex((approval) => approval.id === selectedApprovalId);
          state.nav.selectedIndex = idx >= 0 ? idx : clampIndex(state.nav.selectedIndex, state.approvals.length);
        } else if (state.nav.topLevel === "approvals") {
          state.nav.selectedIndex = clampIndex(state.nav.selectedIndex, state.approvals.length);
        }
      } else {
        state.approvals = [];
        state.pendingApprovals = 0;
        if (state.nav.topLevel === "approvals") {
          state.nav.selectedIndex = 0;
        }
      }

      state.lastUpdatedAt = new Date();
      state.lastRefreshError = null;
    } catch (error) {
      state.lastRefreshError = error instanceof Error ? error.message : String(error);
    } finally {
      refreshInFlight = false;
      // Skip repaint if the user has the new-task form open: background data
      // updates are irrelevant to form content, and repainting mid-typing is
      // the primary cause of visible screen flicker.
      if (state.nav.detail !== "new-task") {
        render();
      }
    }
  };

  // ── Workflow detail fetch ─────────────────────────────────────────────────────

  const fetchWorkflowDetail = async (id: string) => {
    try {
      const data = await fetchJson<{ workflow: WorkflowDetail }>(
        `${baseUrl}/v1/workflows/${id}`,
      );
      if (state.nav.detailId === id && state.nav.detail === "workflow-detail") {
        state.workflowDetail = data.workflow;
        state.workflowDetailLoading = false;
        state.workflowDetailError = null;
        render();
      }
    } catch (err) {
      if (state.nav.detailId === id && state.nav.detail === "workflow-detail") {
        state.workflowDetailLoading = false;
        state.workflowDetailError = err instanceof Error ? err.message : String(err);
        render();
      }
    }
  };

  const fetchApprovalDetail = async (id: string) => {
    try {
      const data = await fetchJson<{ approval: ApprovalDetail }>(
        `${baseUrl}/v1/approvals/${id}`,
      );
      if (state.nav.detailId === id && state.nav.detail === "approval-detail") {
        state.approvalDetail = data.approval;
        state.approvalDetailLoading = false;
        state.approvalDetailError = null;
        render();
      }
    } catch (err) {
      if (state.nav.detailId === id && state.nav.detail === "approval-detail") {
        state.approvalDetailLoading = false;
        state.approvalDetailError = err instanceof Error ? err.message : String(err);
        render();
      }
    }
  };

  const applyApprovalDecision = async (decision: "approve" | "reject") => {
    const id = state.nav.detailId;
    const detail = state.approvalDetail;

    if (!id || state.nav.detail !== "approval-detail" || state.approvalActionLoading) return;
    if (!detail || detail.id !== id) {
      state.flashMessage = "Approval context is still loading.";
      state.flashTone = "info";
      render();
      return;
    }

    const selectedIndex = state.nav.selectedIndex;
    state.approvalActionLoading = true;
    state.flashMessage = null;
    state.flashTone = null;
    render();

    try {
      if (detail.actionMode === "harness-decision") {
        const workflowId = detail.workflow?.id;
        const sprintNumber = detail.workflow?.sprintNumber;
        if (!workflowId || sprintNumber == null) {
          throw new Error("Approval detail is missing workflow sprint context.");
        }
        await postJson(
          `${baseUrl}/v1/pipelines/${workflowId}/sprints/${sprintNumber}/decide`,
          {
            action: decision === "approve" ? "approve_continue" : "reject_and_retry",
            actorId: "console",
          },
        );
      } else if (detail.actionMode === "approval-route") {
        if (decision === "approve") {
          await postJson(`${baseUrl}/v1/approvals/${id}/approve`, {});
        } else {
          await postJson(`${baseUrl}/v1/approvals/${id}/reject`, {});
        }
      } else {
        throw new Error("This approval does not support actions from the console yet.");
      }

      appendLog(state, {
        text: `approval ${shortId(id)} ${decision}d`,
        level: "info",
        category: "ACTION",
        lowSignal: false,
        sourceType: "approval.action",
      });
      state.flashMessage = `${decision === "approve" ? "Approved" : "Rejected"} ${shortId(id)}`;
      state.flashTone = "success";
      state.nav.detail = null;
      state.nav.detailId = null;
      resetApprovalDetail(state);
      resetWorkflowDetail(state);
      state.detailScrollOffset = 0;
      await refresh();
      state.nav.selectedIndex = clampIndex(selectedIndex, state.approvals.length);
      render();
    } catch (err) {
      state.approvalActionLoading = false;
      state.flashMessage = err instanceof Error ? err.message : String(err);
      state.flashTone = "error";
      render();
    }
  };

  // ── WebSocket log stream ─────────────────────────────────────────────────────

  const connectLogs = async () => {
    if (disposed) return;
    try {
      const wsModule = await import("ws");
      const WS = wsModule.default;
      ws = new WS(wsUrl) as unknown as WsClient;

      ws.on("open", () => {
        state.logsConnected = true;
        appendLog(state, {
          text: "websocket connected",
          level: "info",
          category: "STREAM",
          lowSignal: false,
          sourceType: "stream.open",
        });
        render();
      });

      ws.on("close", () => {
        state.logsConnected = false;
        appendLog(state, {
          text: "websocket disconnected",
          level: "warn",
          category: "STREAM",
          lowSignal: false,
          sourceType: "stream.close",
        });
        render();
        if (!disposed && !reconnectTimer) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            void connectLogs();
          }, 3000);
        }
      });

      ws.on("error", () => {
        state.logsConnected = false;
        appendLog(state, {
          text: "websocket error",
          level: "warn",
          category: "STREAM",
          lowSignal: false,
          sourceType: "stream.error",
        });
        render();
      });

      ws.on("message", (...args: unknown[]) => {
        const raw = args[0] as Buffer | string;
        const event = parseEvent(raw);
        if (!event) return;
        state.lastLogEventAt = new Date();
        appendLog(state, describeEvent(event));
        // Only repaint on log events when the logs view is active.
        // Debounce to ~80 ms so rapid bursts produce a single repaint instead
        // of a full-screen clear on every individual event.
        if (state.nav.topLevel === "logs" && !state.nav.detail && !state.logsPaused) {
          if (logRenderTimer) clearTimeout(logRenderTimer);
          logRenderTimer = setTimeout(() => {
            logRenderTimer = null;
            if (!disposed && state.nav.topLevel === "logs" && !state.nav.detail && !state.logsPaused) render();
          }, 80);
        }
      });
    } catch (error) {
      appendLog(
        state,
        {
          text: `Log stream unavailable: ${error instanceof Error ? error.message : String(error)}`,
          level: "warn",
          category: "STREAM",
          lowSignal: false,
          sourceType: "stream.error",
        },
      );
      render();
    }
  };

  // ── New Task form: submit ────────────────────────────────────────────────────

  const submitNewTask = async (): Promise<void> => {
    const form = state.newTaskForm;
    if (!form.title.trim()) {
      form.submitError = "Title is required.";
      render();
      return;
    }

    form.submitting = true;
    form.submitError = null;
    render();

    try {
      const result = await postJson<IntakeResult>(`${baseUrl}/v1/intake/requests`, {
        source: "cli",
        type: form.workType,
        title: form.title.trim(),
        executionMode: form.executionMode,
        requestedBy: "console",
      });

      // Success: close form, switch to workflows, refresh to show new workflow
      state.nav.detail = null;
      state.nav.detailId = null;
      state.nav.topLevel = "workflows";
      await refresh();

      // Select the newly created workflow if found
      const idx = state.workflows.findIndex((w) => w.id === result.pipelineRunId);
      if (idx >= 0) {
        state.nav.selectedIndex = idx;
        render();
      }
    } catch (err) {
      form.submitting = false;
      form.submitError = err instanceof Error ? err.message : String(err);
      render();
    }
  };

  // ── New Task form: key handler ───────────────────────────────────────────────

  type KeyInfo = { name?: string; ctrl?: boolean; meta?: boolean; shift?: boolean; sequence?: string };

  const FIELD_ORDER: NewTaskFocusField[] = ["type", "title", "mode", "submit"];

  const handleNewTaskKey = (str: string, key: KeyInfo): void => {
    const form = state.newTaskForm;
    if (form.submitting) return;

    // ── Field cycling: Tab / Shift-Tab ──────────────────────────────────────
    if (key.name === "tab") {
      const idx = FIELD_ORDER.indexOf(form.focusField);
      if (key.shift) {
        form.focusField = FIELD_ORDER[(idx - 1 + FIELD_ORDER.length) % FIELD_ORDER.length];
      } else {
        form.focusField = FIELD_ORDER[(idx + 1) % FIELD_ORDER.length];
      }
      render();
      return;
    }

    const focus = form.focusField;

    // ── Type field ──────────────────────────────────────────────────────────
    if (focus === "type") {
      if (key.name === "left" || key.name === "right" || key.name === "space") {
        form.workType = form.workType === "feature" ? "bug" : "feature";
        render();
      } else if (key.name === "down" || key.name === "return" || key.name === "enter") {
        form.focusField = "title";
        render();
      }
      // ↑ at the top field is a no-op
      return;
    }

    // ── Title field ─────────────────────────────────────────────────────────
    if (focus === "title") {
      if (key.name === "backspace") {
        form.title = form.title.slice(0, -1);
        render();
        return;
      }

      // ↑ goes back to type field
      if (key.name === "up") {
        form.focusField = "type";
        render();
        return;
      }

      // Enter without Ctrl: move to mode field
      // Ctrl+Enter: submit
      if (key.name === "return" || key.name === "enter") {
        if (key.ctrl) {
          void submitNewTask();
        } else {
          form.focusField = "mode";
          render();
        }
        return;
      }

      // ↓ moves to mode (same as Enter without Ctrl)
      if (key.name === "down") {
        form.focusField = "mode";
        render();
        return;
      }

      // Printable characters: ASCII + Unicode.
      // Guard: no control sequences, no arrow/special keys, char code >= 32.
      if (
        !key.ctrl &&
        !key.meta &&
        key.name !== "escape" &&
        key.name !== "tab" &&
        key.name !== "left" &&
        key.name !== "right" &&
        str &&
        !str.startsWith("\x1b") &&
        str.charCodeAt(0) >= 32
      ) {
        form.title += str;
        render();
      }
      return;
    }

    // ── Mode field ──────────────────────────────────────────────────────────
    if (focus === "mode") {
      if (key.name === "left" || key.name === "right" || key.name === "space") {
        form.executionMode = form.executionMode === "fast" ? "structured" : "fast";
        render();
      } else if (key.name === "up") {
        form.focusField = "title";
        render();
      } else if (key.name === "down" || key.name === "return" || key.name === "enter") {
        form.focusField = "submit";
        render();
      }
      return;
    }

    // ── Submit field ────────────────────────────────────────────────────────
    if (focus === "submit") {
      if (key.name === "up") {
        form.focusField = "mode";
        render();
      } else if (key.name === "return" || key.name === "enter" || key.name === "space") {
        void submitNewTask();
      }
      // ↓ at the bottom field is a no-op
      return;
    }
  };

  // ── Keyboard navigation ─────────────────────────────────────────────────────

  const keypressHandler = (str: string, key: KeyInfo) => {
    if (!key) return;

    // Global: quit
    if (key.ctrl && key.name === "c") {
      if (!state.shutdownRequested) {
        state.shutdownRequested = true;
        render();
        opts.onRequestShutdown();
      }
      return;
    }

    // ESC: cancel/back (blocked while new-task is submitting)
    if (key.name === "escape" || key.name === "esc") {
      if (state.nav.detail) {
        if (state.nav.detail === "new-task" && state.newTaskForm.submitting) return;
        state.nav.detail = null;
        state.nav.detailId = null;
        resetWorkflowDetail(state);
        resetApprovalDetail(state);
        state.detailScrollOffset = 0;
        render();
      }
      return;
    }

    // New-task form: delegate all keys to form handler
    if (state.nav.detail === "new-task") {
      handleNewTaskKey(str, key);
      return;
    }

    // Other detail views: scroll / refresh / quit
    if (state.nav.detail) {
      switch (key.name) {
        case "up":
          if (
            (state.nav.detail === "workflow-detail" || state.nav.detail === "approval-detail")
            && state.detailScrollOffset > 0
          ) {
            state.detailScrollOffset--;
            render();
          }
          break;
        case "down":
          if (state.nav.detail === "workflow-detail" || state.nav.detail === "approval-detail") {
            state.detailScrollOffset++;
            render(); // view clamps offset on render
          }
          break;
        case "a":
          if (state.nav.detail === "approval-detail") {
            void applyApprovalDecision("approve");
          }
          break;
        case "r":
          if (state.nav.detail === "approval-detail") {
            void applyApprovalDecision("reject");
          } else if (state.nav.detail === "workflow-detail" && state.nav.detailId) {
            state.workflowDetailLoading = true;
            render();
            void fetchWorkflowDetail(state.nav.detailId);
          } else {
            void refresh();
          }
          break;
        case "q":
          if (!state.shutdownRequested) {
            state.shutdownRequested = true;
            render();
            opts.onRequestShutdown();
          }
          break;
      }
      return;
    }

    // Top-level navigation
    switch (key.name) {
      // ── View switching ──────────────────────────────────────────────────────
      case "o":
        state.nav.topLevel = "overview";
        state.nav.selectedIndex = 0;
        render();
        break;
      case "w":
        state.nav.topLevel = "workflows";
        state.nav.selectedIndex = clampIndex(0, state.workflows.length);
        render();
        break;
      case "a":
        state.nav.topLevel = "approvals";
        state.nav.selectedIndex = clampIndex(0, state.approvals.length);
        render();
        break;
      case "l":
        state.nav.topLevel = "logs";
        state.nav.selectedIndex = 0;
        render();
        break;

      // ── New task: reset form then open ──────────────────────────────────────
      case "n":
        state.newTaskForm = {
          focusField: "type",
          workType: "feature",
          title: "",
          executionMode: "fast",
          submitting: false,
          submitError: null,
        };
        state.nav.detail = "new-task";
        state.nav.detailId = null;
        render();
        break;

      // ── Jump to first active workflow ───────────────────────────────────────
      case "g": {
        if (state.nav.topLevel === "workflows" && state.workflows.length > 0) {
          const idx = state.workflows.findIndex((w) => {
            const s = (w.status ?? "").toLowerCase();
            return s === "running" || s === "in_progress" || s === "approval_pending";
          });
          if (idx >= 0) {
            state.nav.selectedIndex = idx;
            render();
          }
        }
        break;
      }

      // ── List navigation ─────────────────────────────────────────────────────
      case "up": {
        if (state.nav.topLevel !== "workflows" && state.nav.topLevel !== "approvals") break;
        const listLen =
          state.nav.topLevel === "approvals" ? state.approvals.length : state.workflows.length;
        if (listLen > 0) {
          state.nav.selectedIndex = clampIndex(state.nav.selectedIndex - 1, listLen);
          render();
        }
        break;
      }
      case "down": {
        if (state.nav.topLevel !== "workflows" && state.nav.topLevel !== "approvals") break;
        const listLen =
          state.nav.topLevel === "approvals" ? state.approvals.length : state.workflows.length;
        if (listLen > 0) {
          state.nav.selectedIndex = clampIndex(state.nav.selectedIndex + 1, listLen);
          render();
        }
        break;
      }

      // ── Open detail ─────────────────────────────────────────────────────────
      case "return":
      case "enter": {
        if (state.nav.topLevel === "workflows" && state.workflows.length > 0) {
          const wf = state.workflows[state.nav.selectedIndex];
          if (wf) {
            state.nav.detail = "workflow-detail";
            state.nav.detailId = wf.id;
            resetWorkflowDetail(state);
            resetApprovalDetail(state);
            state.workflowDetailLoading = true;
            state.detailScrollOffset = 0;
            render(); // show header immediately from list cache
            void fetchWorkflowDetail(wf.id);
          }
        } else if (state.nav.topLevel === "approvals" && state.approvals.length > 0) {
          const ap = state.approvals[state.nav.selectedIndex];
          if (ap) {
            state.nav.detail = "approval-detail";
            state.nav.detailId = ap.id;
            resetWorkflowDetail(state);
            resetApprovalDetail(state);
            state.approvalDetailLoading = true;
            state.flashMessage = null;
            state.flashTone = null;
            state.detailScrollOffset = 0;
            render();
            void fetchApprovalDetail(ap.id);
          }
        }
        break;
      }

      // ── Logs-specific ───────────────────────────────────────────────────────
      case "h":
        if (state.nav.topLevel === "logs") {
          state.heartbeatFilterEnabled = !state.heartbeatFilterEnabled;
          render();
        }
        break;
      case "e":
        if (state.nav.topLevel === "logs") {
          state.logSeverityMode = state.logSeverityMode === "all" ? "warn-error" : "all";
          render();
        }
        break;
      case "p":
        if (state.nav.topLevel === "logs") {
          state.logsPaused = !state.logsPaused;
          render();
        }
        break;
      case "c":
        if (state.nav.topLevel === "logs") {
          state.logs = [];
          state.lastLogEventAt = null;
          state.flashMessage = "Logs cleared";
          state.flashTone = "info";
          render();
        }
        break;

      // ── Global actions ──────────────────────────────────────────────────────
      case "r":
        void refresh();
        break;
      case "q":
        if (!state.shutdownRequested) {
          state.shutdownRequested = true;
          render();
          opts.onRequestShutdown();
        }
        break;
    }
  };

  // ── Cleanup ─────────────────────────────────────────────────────────────────

  const cleanup = () => {
    if (disposed) return;
    disposed = true;

    if (refreshTimer) clearInterval(refreshTimer);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (logRenderTimer) clearTimeout(logRenderTimer);
    if (ws) ws.close();

    if (canCaptureKeyboard) {
      process.stdin.off("keypress", keypressHandler);
      process.stdin.setRawMode(false);
    }

    process.stdout.write("\x1b[?25h"); // restore cursor
  };

  // ── Boot ─────────────────────────────────────────────────────────────────────

  if (canCaptureKeyboard) {
    emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("keypress", keypressHandler);
  }

  process.stdout.write("\x1b[?25l"); // hide cursor
  appendLog(state, {
    text: "console log stream ready",
    level: "info",
    category: "SYSTEM",
    lowSignal: false,
    sourceType: "console.ready",
  });
  await connectLogs();
  await refresh();
  refreshTimer = setInterval(() => void refresh(), 3000);
  render();

  return cleanup;
}
