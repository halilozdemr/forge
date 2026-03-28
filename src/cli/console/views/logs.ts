import type { ConsoleState, LayoutRegions } from "../types.js";
import { BOLD, DIM, GREEN, YELLOW, R, clip } from "../layout.js";

export function renderLogs(state: ConsoleState, layout: LayoutRegions): string[] {
  const lines: string[] = [];

  const wsIndicator = state.logsConnected
    ? `${GREEN}● connected${R}`
    : `${YELLOW}● disconnected${R}`;
  const filterStr = state.heartbeatFilterEnabled
    ? `${DIM}hb filter: on${R}`
    : `${YELLOW}hb filter: off${R}`;

  lines.push(` ${BOLD}LIVE LOGS${R}  ${wsIndicator}  ${filterStr}`);
  lines.push("");

  const available = Math.max(1, layout.contentHeight - 2);
  const visible = state.logs.slice(-available);

  if (visible.length === 0) {
    lines.push(`  ${DIM}no events yet — events stream here while Forge is running${R}`);
  } else {
    for (const entry of visible) {
      const repeat = entry.repeat > 1 ? ` ${DIM}(×${entry.repeat})${R}` : "";
      lines.push(clip(` ${DIM}${entry.ts}${R}  ${entry.text}${repeat}`, layout.width));
    }
  }

  return lines;
}
