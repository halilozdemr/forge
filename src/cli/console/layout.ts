import type { LayoutRegions } from "./types.js";

// ── ANSI escape codes ──────────────────────────────────────────────────────────
export const R = "\x1b[0m";
export const BOLD = "\x1b[1m";
export const DIM = "\x1b[2m";
export const GREEN = "\x1b[32m";
export const YELLOW = "\x1b[33m";
export const RED = "\x1b[31m";
export const CYAN = "\x1b[36m";
export const BLUE = "\x1b[34m";
export const MAGENTA = "\x1b[35m";

// Rows consumed by the fixed shell chrome
const HEADER_ROWS = 2; // title line + separator
const FOOTER_ROWS = 3; // separator + status line + keymap line

export function getLayout(): LayoutRegions {
  const width = Math.max(80, process.stdout.columns ?? 100);
  const height = Math.max(24, process.stdout.rows ?? 30);
  return {
    width,
    height,
    contentHeight: Math.max(6, height - HEADER_ROWS - FOOTER_ROWS),
  };
}

// ── String helpers ─────────────────────────────────────────────────────────────

/** Length of the visible (non-ANSI) portion of a string. */
export function visibleLength(text: string): number {
  return text.replace(/\x1b\[[0-9;]*m/g, "").length;
}

/** Pad to a visible width, appending spaces after any trailing reset codes. */
export function padEnd(text: string, width: number): string {
  const vlen = visibleLength(text);
  if (vlen >= width) return text;
  return text + " ".repeat(width - vlen);
}

/** Clip to a visible width.  ANSI codes are stripped when clipping is needed. */
export function clip(text: string | null | undefined, max: number): string {
  const visible = (text ?? "").replace(/\x1b\[[0-9;]*m/g, "");
  if (visible.length <= max) return text ?? "";
  if (max <= 1) return visible.slice(0, max);
  return visible.slice(0, max - 1) + "…";
}

/** Horizontal rule of a given width. */
export function hr(width: number, char = "─"): string {
  return char.repeat(width);
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

export function colorStatus(status: string): string {
  const n = status.toLowerCase();
  if (n === "running" || n === "in_progress") return `${YELLOW}${status}${R}`;
  if (n === "completed" || n === "done") return `${GREEN}${status}${R}`;
  if (n === "failed" || n === "cancelled") return `${RED}${status}${R}`;
  if (n === "approval_pending" || n === "pending") return `${CYAN}${status}${R}`;
  return `${DIM}${status}${R}`;
}

// ── Split-pane helpers ─────────────────────────────────────────────────────────

/**
 * Combine a left and right content line with a visible separator.
 * `leftWidth` is the visible column width of the left pane.
 */
export function splitLine(left: string, right: string, leftWidth: number): string {
  return padEnd(left, leftWidth) + `${DIM}│${R}` + right;
}

/**
 * Zip two arrays of lines into a split-pane view.
 * Missing lines are treated as empty strings.
 */
export function zipPanes(leftLines: string[], rightLines: string[], leftWidth: number): string[] {
  const count = Math.max(leftLines.length, rightLines.length);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push(splitLine(leftLines[i] ?? "", rightLines[i] ?? "", leftWidth));
  }
  return out;
}
