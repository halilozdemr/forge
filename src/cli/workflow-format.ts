/** Shared formatting helpers for workflow output (list, show, watch, run). */

export const RESET = "\x1b[0m";
export const BOLD = "\x1b[1m";

const STATUS_COLORS: Record<string, string> = {
  pending: "\x1b[90m",
  running: "\x1b[33m",
  completed: "\x1b[32m",
  failed: "\x1b[31m",
  cancelled: "\x1b[35m",
};

export function colorStatus(status: string, pad = 0): string {
  const c = STATUS_COLORS[status] ?? "";
  const s = pad > 0 ? status.padEnd(pad) : status;
  return `${c}${s}${RESET}`;
}

export function formatDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString();
}

export function progressBar(completed: number, total: number): string {
  if (total === 0) return "no steps";
  const pct = Math.round((completed / total) * 100);
  const filled = Math.round((completed / total) * 10);
  const bar = "█".repeat(filled) + "░".repeat(10 - filled);
  return `${bar} ${completed}/${total} (${pct}%)`;
}
