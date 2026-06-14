import type { WorkflowSummary, WorkflowStep } from "../types.js";

/**
 * Shared presentation helpers for the Ink console. These mirror the formatting
 * rules used by the legacy ANSI shell so both renderers stay visually aligned,
 * but they return semantic values (Ink color names / booleans) instead of raw
 * escape codes.
 */

export type InkColor = "green" | "yellow" | "red" | "cyan" | "blue" | "magenta";

/** Map a workflow/approval/step status to an Ink color, or null when it should render dim. */
export function statusColor(status: string | null | undefined): InkColor | null {
  const n = (status ?? "").toLowerCase();
  if (n === "running" || n === "in_progress") return "yellow";
  if (n === "completed" || n === "done") return "green";
  if (n === "failed" || n === "cancelled") return "red";
  if (n === "approval_pending" || n === "pending") return "cyan";
  return null;
}

/** True for statuses that should stand out even when not selected. */
export function isAttentionStatus(status: string | null | undefined): boolean {
  const s = (status ?? "").toLowerCase();
  return s === "running" || s === "in_progress" || s === "approval_pending" || s === "failed";
}

export function shortId(id: string): string {
  return id.length <= 8 ? id : id.slice(0, 8);
}

export function nowTime(): string {
  return new Date().toTimeString().slice(0, 8);
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "none";
  const mins = Math.floor(ms / (1000 * 60));
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return hours > 0 ? `${hours}h ${remMins}m` : `${remMins}m`;
}

export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return "just now";
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function stepDuration(step: WorkflowStep): string {
  if (!step.startedAt) return "—";
  const start = new Date(step.startedAt).getTime();
  const end = step.completedAt ? new Date(step.completedAt).getTime() : Date.now();
  const secs = Math.floor((end - start) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  return `${mins}m${String(secs % 60).padStart(2, "0")}s`;
}

export function stepIndicator(status: string, attempts: number): string {
  const s = (status ?? "").toLowerCase();
  if (s === "completed" || s === "done") return "[+]";
  if (s === "running" || s === "in_progress") return attempts > 1 ? "[~]" : "[>]";
  if (s === "failed") return "[!]";
  if (s === "approval_pending") return "[?]";
  if (s === "cancelled") return "[x]";
  return "[-]";
}

// ── Workflow priority sort (running > blocked > failed > pending > done) ────────

function statusPriority(status: string): number {
  const s = (status ?? "").toLowerCase();
  if (s === "running" || s === "in_progress") return 0;
  if (s === "approval_pending") return 1;
  if (s === "failed") return 2;
  if (s === "pending") return 3;
  if (s === "cancelled") return 4;
  if (s === "completed" || s === "done") return 5;
  return 6;
}

export function sortWorkflows(wfs: WorkflowSummary[]): WorkflowSummary[] {
  return [...wfs].sort((a, b) => statusPriority(a.status ?? "") - statusPriority(b.status ?? ""));
}

/** Clamp an index into a list of the given length. */
export function clampIndex(index: number, length: number): number {
  if (length === 0) return 0;
  return Math.max(0, Math.min(index, length - 1));
}

/**
 * Compute a scroll window [start, end) so that `selected` stays visible within
 * `visible` rows. Mirrors the legacy shell's scroll-window math.
 */
export function scrollWindow(selected: number, total: number, visible: number): { start: number; end: number } {
  if (total <= visible) return { start: 0, end: total };
  const start = Math.max(0, Math.min(selected - visible + 1, total - visible));
  return { start, end: start + visible };
}
