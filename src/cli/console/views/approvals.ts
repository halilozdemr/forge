import type { ConsoleState, LayoutRegions } from "../types.js";
import { BOLD, CYAN, DIM, YELLOW, R, padEnd, clip, shortId, hr, zipPanes } from "../layout.js";

/** Left pane: pending approval list with cursor */
function buildListLines(state: ConsoleState, listHeight: number, leftWidth: number): string[] {
  const lines: string[] = [];
  const count = state.approvals.length;

  const badge = count > 0 ? `${YELLOW}${count} pending${R}` : `${DIM}none${R}`;
  lines.push(` ${BOLD}APPROVALS${R}  ${badge}`);
  lines.push(` ${DIM}${hr(leftWidth - 2)}${R}`);

  if (count === 0) {
    lines.push(`  ${DIM}no pending approvals${R}`);
    return lines;
  }

  const sel = state.nav.selectedIndex;
  const maxVisible = Math.max(1, listHeight - lines.length);
  const scrollOffset = Math.max(0, sel - maxVisible + 1);

  for (
    let i = scrollOffset;
    i < state.approvals.length && i < scrollOffset + maxVisible;
    i++
  ) {
    const ap = state.approvals[i];
    const isSelected = i === sel;
    const cursor = isSelected ? `${CYAN}►${R}` : " ";
    const title = clip(ap.issueTitle ?? shortId(ap.id), leftWidth - 14);
    const stepStr = padEnd(ap.stepKey ? `${DIM}[${ap.stepKey}]${R}` : "", 12);
    const row = `${cursor} ${stepStr} ${title}`;
    lines.push(isSelected ? row : `${DIM}${row}${R}`);
  }

  return lines;
}

/** Right pane: detail for selected approval */
function buildDetailLines(state: ConsoleState, rightWidth: number): string[] {
  const lines: string[] = [];
  const ap = state.approvals[state.nav.selectedIndex] ?? null;

  lines.push(` ${BOLD}DETAIL${R}`);
  lines.push(` ${DIM}${hr(rightWidth - 2)}${R}`);

  if (!ap) {
    lines.push(`  ${DIM}select an approval${R}`);
    return lines;
  }

  const lw = 8;
  lines.push(`  ${DIM}${"id".padEnd(lw)}${R}${shortId(ap.id)}`);
  if (ap.stepKey) lines.push(`  ${DIM}${"step".padEnd(lw)}${R}${ap.stepKey}`);
  if (ap.issueTitle) lines.push(`  ${DIM}${"title".padEnd(lw)}${R}${clip(ap.issueTitle, rightWidth - lw - 4)}`);
  if (ap.createdAt) lines.push(`  ${DIM}${"at".padEnd(lw)}${R}${ap.createdAt}`);
  lines.push("");
  lines.push(`  ${DIM}[enter] review & act${R}`);

  return lines;
}

export function renderApprovals(state: ConsoleState, layout: LayoutRegions): string[] {
  const leftWidth = Math.floor(layout.width * 0.62);
  const rightWidth = layout.width - leftWidth - 1;

  const leftLines = buildListLines(state, layout.contentHeight, leftWidth);
  const detailLines = buildDetailLines(state, rightWidth);

  return zipPanes(leftLines, detailLines, leftWidth);
}
