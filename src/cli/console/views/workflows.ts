import type { ConsoleState, LayoutRegions, WorkflowSummary } from "../types.js";
import {
  BOLD, CYAN, DIM, RED, YELLOW, R,
  colorStatus, fit, clip, shortId, hr, zipPanes, formatRelativeTime, sectionHeader,
} from "../layout.js";

// ── Column widths ─────────────────────────────────────────────────────────────
const STATUS_W = 13;
const TYPE_W   = 10;
const PROG_W   =  6;
const PREFIX   =  2; // cursor char (1) + space (1)

function titleWidth(leftWidth: number): number {
  return Math.max(4, leftWidth - PREFIX - STATUS_W - TYPE_W - PROG_W);
}

// ── Workflow priority sort ─────────────────────────────────────────────────────

function statusPriority(status: string): number {
  const s = (status ?? "").toLowerCase();
  if (s === "running" || s === "in_progress")  return 0;
  if (s === "approval_pending")                return 1;
  if (s === "failed")                          return 2;
  if (s === "pending")                         return 3;
  if (s === "cancelled")                       return 4;
  if (s === "completed" || s === "done")       return 5;
  return 6;
}

/** Sort by urgency: running > blocked > failed > pending > done. Stable within groups. */
export function sortWorkflows(wfs: WorkflowSummary[]): WorkflowSummary[] {
  return [...wfs].sort((a, b) => statusPriority(a.status ?? "") - statusPriority(b.status ?? ""));
}

// ── Row coloring helpers ───────────────────────────────────────────────────────

/** True for statuses that should stand out even when not selected. */
function isHighlight(status: string): boolean {
  const s = (status ?? "").toLowerCase();
  return s === "running" || s === "in_progress" || s === "approval_pending" || s === "failed";
}

// ── Row builder ───────────────────────────────────────────────────────────────

/**
 * 3-tier coloring strategy:
 *
 *   Selected          → CYAN cursor + colored status + plain type/prog/title
 *   Attention (non-sel) → colored status + DIM type/prog/title   (running/failed/approval_pending)
 *   Normal (non-sel)  → full DIM row                              (completed/pending/cancelled)
 *
 * The attention rows use `  ` (2 plain spaces) as cursor placeholder so that
 * the column header `STATUS` label still aligns.  The `colorStatus()` return
 * value contains an embedded ${R}; the subsequent ${DIM} then re-enables dim
 * for the rest of the row — no outer DIM collision.
 */
function buildRow(wf: WorkflowSummary, isSelected: boolean, titleW: number): string {
  const prog      = `${wf.progress?.completed ?? 0}/${wf.progress?.total ?? 0}`;
  const statusText = clip(wf.status ?? "", STATUS_W);
  const typeStr    = fit(wf.type ?? "", TYPE_W);
  const progStr    = fit(prog, PROG_W);
  const titleStr   = clip(wf.issueTitle ?? shortId(wf.id), titleW);

  if (isSelected) {
    const statusCol = fit(colorStatus(statusText), STATUS_W);
    return `${CYAN}>${R} ${statusCol}${typeStr}${progStr}${titleStr}`;
  }

  if (isHighlight(wf.status ?? "")) {
    // Colored status + DIM rest: the ${R} inside colorStatus resets; ${DIM} then
    // re-applies to type/prog/title without a collision.
    const statusCol = fit(colorStatus(statusText), STATUS_W);
    return `  ${statusCol}${DIM}${typeStr}${progStr}${titleStr}${R}`;
  }

  // Plain DIM for completed / cancelled / pending / unknown
  return `${DIM}  ${fit(statusText, STATUS_W)}${typeStr}${progStr}${titleStr}${R}`;
}

// ── Left pane ─────────────────────────────────────────────────────────────────

function buildListLines(state: ConsoleState, listHeight: number, leftWidth: number): string[] {
  const lines: string[] = [];
  const tW = titleWidth(leftWidth);

  // ── Header with live counts ───────────────────────────────────────────────
  const running = state.workflows.filter((w) => {
    const s = (w.status ?? "").toLowerCase();
    return s === "running" || s === "in_progress";
  }).length;
  const blocked = state.workflows.filter((w) => {
    const s = (w.status ?? "").toLowerCase();
    return s === "approval_pending" || s === "failed";
  }).length;

  let headerRight = `${DIM}${state.workflows.length} total${R}`;
  if (running > 0) headerRight += `  ${YELLOW}${running} running${R}`;
  if (blocked > 0) headerRight += `  ${RED}${blocked} blocked${R}`;

  lines.push(...sectionHeader("WORKFLOWS", leftWidth, headerRight));

  // Column header — same PREFIX (2 spaces) as data rows
  lines.push(
    `  ${DIM}` +
    `${"STATUS".padEnd(STATUS_W)}` +
    `${"TYPE".padEnd(TYPE_W)}` +
    `${"PROG".padEnd(PROG_W)}` +
    `TITLE${R}`,
  );

  // ── Empty / loading state ─────────────────────────────────────────────────
  if (state.workflows.length === 0) {
    if (state.lastUpdatedAt === null) {
      lines.push(`  ${DIM}loading…${R}`);
    } else {
      lines.push(`  ${DIM}no workflows yet${R}`);
      lines.push(`  ${DIM}press [n] to start a new task${R}`);
    }
    return lines;
  }

  // ── Scroll window ─────────────────────────────────────────────────────────
  const sel = state.nav.selectedIndex;
  const maxVisible = Math.max(1, listHeight - lines.length);
  const scrollOffset = Math.max(0, sel - maxVisible + 1);

  for (
    let i = scrollOffset;
    i < state.workflows.length && i < scrollOffset + maxVisible;
    i++
  ) {
    lines.push(buildRow(state.workflows[i], i === sel, tW));
  }

  // Scroll hint
  const remaining = state.workflows.length - (scrollOffset + maxVisible);
  if (remaining > 0) {
    lines.push(`  ${DIM}↓ ${remaining} more${R}`);
  }

  return lines;
}

// ── Right pane (preview) ──────────────────────────────────────────────────────

function buildPreviewLines(state: ConsoleState, rightWidth: number): string[] {
  const lines: string[] = [];
  const wf = state.workflows[state.nav.selectedIndex] ?? null;

  lines.push(...sectionHeader("DETAIL", rightWidth));

  if (!wf) {
    lines.push(`  ${DIM}no workflow selected${R}`);
    return lines;
  }

  const lw = 9; // label column width
  const valW = Math.max(4, rightWidth - lw - 4);

  function field(label: string, value: string): string {
    return `  ${DIM}${label.padEnd(lw)}${R}${clip(value, valW)}`;
  }

  // Status (colored) + type
  lines.push(`  ${DIM}${"status".padEnd(lw)}${R}${colorStatus(clip(wf.status ?? "", valW))}${R}`);
  lines.push(field("type", wf.type ?? "—"));
  lines.push(field("step", wf.currentStepKey ?? "—"));

  const prog = `${wf.progress?.completed ?? 0}/${wf.progress?.total ?? 0} steps`;
  lines.push(field("progress", prog));

  const ts = wf.updatedAt ?? wf.createdAt;
  if (ts) {
    lines.push(field("updated", formatRelativeTime(ts)));
  }

  lines.push("");

  // Issue title — prominent
  if (wf.issueTitle) {
    lines.push(`  ${clip(wf.issueTitle, rightWidth - 4)}`);
    lines.push("");
  }

  // Attention hints
  const s = (wf.status ?? "").toLowerCase();
  if (s === "approval_pending") {
    lines.push(`  ${CYAN}! Approval pending${R}`);
    lines.push("");
  } else if (s === "failed" && wf.lastError) {
    lines.push(`  ${RED}! ${clip(wf.lastError, rightWidth - 6)}${R}`);
    lines.push("");
  }

  lines.push(`  ${DIM}[enter] inspect${R}`);

  return lines;
}

// ── Entry point ───────────────────────────────────────────────────────────────

export function renderWorkflows(state: ConsoleState, layout: LayoutRegions): string[] {
  const leftWidth  = Math.min(Math.max(Math.floor(layout.width * 0.62), 46), layout.width - 22);
  const rightWidth = layout.width - leftWidth - 1; // 1 for the │ separator

  const leftLines  = buildListLines(state, layout.contentHeight, leftWidth);
  const rightLines = buildPreviewLines(state, rightWidth);

  return zipPanes(leftLines, rightLines, leftWidth, rightWidth, layout.contentHeight);
}
