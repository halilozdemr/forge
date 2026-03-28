import type { ConsoleState, LayoutRegions } from "../types.js";
import {
  BOLD, DIM, GREEN, YELLOW, RED, CYAN, R,
  clip, formatRelativeTime, hr, padEnd, sectionHeader,
} from "../layout.js";

function colorLevel(level: "info" | "warn" | "error"): string {
  if (level === "error") return RED;
  if (level === "warn") return YELLOW;
  return CYAN;
}

function applyFilters(state: ConsoleState) {
  let hiddenLowSignal = 0;
  let hiddenSeverity = 0;
  let visibleCount = 0;
  let totalCount = 0;
  let warnCount = 0;
  let errorCount = 0;

  const visible = state.logs.filter((entry) => {
    totalCount += entry.repeat;
    if (entry.level === "warn") warnCount += entry.repeat;
    if (entry.level === "error") errorCount += entry.repeat;

    if (state.heartbeatFilterEnabled && entry.lowSignal) {
      hiddenLowSignal += entry.repeat;
      return false;
    }
    if (state.logSeverityMode === "warn-error" && entry.level === "info") {
      hiddenSeverity += entry.repeat;
      return false;
    }
    visibleCount += entry.repeat;
    return true;
  });

  return { visible, visibleCount, totalCount, hiddenLowSignal, hiddenSeverity, warnCount, errorCount };
}

export function renderLogs(state: ConsoleState, layout: LayoutRegions): string[] {
  const lines: string[] = [];

  const wsIndicator = state.logsConnected ? `${GREEN}● connected${R}` : `${YELLOW}● reconnecting${R}`;
  const tailState = state.logsPaused ? `${YELLOW}paused${R}` : `${GREEN}live tail${R}`;
  const lastEvent = state.lastLogEventAt ? formatRelativeTime(state.lastLogEventAt.toISOString()) : "never";
  const flowState = !state.lastLogEventAt
    ? `${DIM}idle${R}`
    : Date.now() - state.lastLogEventAt.getTime() < 15_000
      ? `${GREEN}flowing${R}`
      : `${YELLOW}quiet${R}`;
  const lowSignal = state.heartbeatFilterEnabled ? `${GREEN}noise↓${R}` : `${YELLOW}noise all${R}`;
  const severity = state.logSeverityMode === "warn-error" ? `${YELLOW}warn/error${R}` : `${DIM}all levels${R}`;
  const stats = applyFilters(state);
  const hiddenTotal = stats.hiddenLowSignal + stats.hiddenSeverity;

  lines.push(...sectionHeader("LIVE LOGS", layout.width, `${wsIndicator}  ${tailState}  ${flowState}`));
  lines.push(
    ` ${DIM}last${R} ${lastEvent}  ${DIM}visible${R} ${stats.visibleCount}/${stats.totalCount}` +
    `  ${DIM}hidden${R} ${hiddenTotal}  ${DIM}warn${R} ${stats.warnCount}  ${DIM}err${R} ${stats.errorCount}`,
  );
  lines.push(` ${DIM}filters${R} ${lowSignal}  ${severity}`);

  const available = Math.max(1, layout.contentHeight - lines.length);
  const visible = stats.visible.slice(-available);

  if (visible.length === 0) {
    if (state.logs.length === 0) {
      lines.push(`  ${DIM}no events yet — runtime activity will stream here${R}`);
    } else {
      lines.push(`  ${DIM}no logs match the current filters${R}`);
      lines.push(`  ${DIM}toggle [h] or [e], or clear with [c]${R}`);
    }
  } else {
    for (const entry of visible) {
      const levelColor = colorLevel(entry.level);
      const level = `${levelColor}${padEnd(entry.level.toUpperCase(), 5)}${R}`;
      const category = `${DIM}${padEnd(entry.category, 8)}${R}`;
      const repeat = entry.repeat > 1 ? ` ${DIM}×${entry.repeat}${R}` : "";
      lines.push(clip(` ${DIM}${entry.ts}${R}  ${level} ${category} ${entry.text}${repeat}`, layout.width));
    }
  }

  return lines;
}
