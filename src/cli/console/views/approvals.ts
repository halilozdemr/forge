import type { ConsoleState, LayoutRegions } from "../types.js";
import {
  BOLD, CYAN, DIM, YELLOW, R,
  fit, clip, shortId, zipPanes, formatRelativeTime, sectionHeader,
} from "../layout.js";

/** Left pane: pending approval list with cursor */
function buildListLines(state: ConsoleState, listHeight: number, leftWidth: number): string[] {
  const lines: string[] = [];
  const count = state.approvals.length;

  const badge = count > 0 ? `${YELLOW}${count} pending${R}` : `${DIM}none${R}`;
  lines.push(...sectionHeader("APPROVALS", leftWidth, badge));

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
    const title = clip(ap.title ?? ap.issueTitle ?? shortId(ap.id), leftWidth - 20);
    const badge = ap.stepKey ?? ap.type;
    const stepStr = fit(badge ? `${DIM}[${badge}]${R}` : "", 18);
    const row = `${cursor} ${stepStr} ${title}`;
    lines.push(isSelected ? row : `${DIM}${row}${R}`);
  }

  return lines;
}

/** Right pane: detail for selected approval */
function buildDetailLines(state: ConsoleState, rightWidth: number): string[] {
  const lines: string[] = [];
  const ap = state.approvals[state.nav.selectedIndex] ?? null;

  lines.push(...sectionHeader("DETAIL", rightWidth));

  if (!ap) {
    lines.push(`  ${DIM}select an approval${R}`);
    return lines;
  }

  const lw = 8;
  lines.push(`  ${DIM}${"id".padEnd(lw)}${R}${shortId(ap.id)}`);
  lines.push(`  ${DIM}${"type".padEnd(lw)}${R}${ap.type}`);
  lines.push(`  ${DIM}${"status".padEnd(lw)}${R}${ap.status}`);
  if (ap.requestedBy) lines.push(`  ${DIM}${"from".padEnd(lw)}${R}${ap.requestedBy}`);
  if (ap.stepKey) lines.push(`  ${DIM}${"step".padEnd(lw)}${R}${ap.stepKey}`);
  if (ap.agentSlug) lines.push(`  ${DIM}${"agent".padEnd(lw)}${R}@${ap.agentSlug}`);
  if (ap.issueTitle) lines.push(`  ${DIM}${"issue".padEnd(lw)}${R}${clip(ap.issueTitle, rightWidth - lw - 4)}`);
  if (ap.requestedAt) lines.push(`  ${DIM}${"opened".padEnd(lw)}${R}${formatRelativeTime(ap.requestedAt)}`);
  if (ap.reason) lines.push(`  ${DIM}${"why".padEnd(lw)}${R}${clip(ap.reason, rightWidth - lw - 4)}`);
  lines.push("");
  lines.push(`  ${clip(ap.description ?? ap.title ?? "", rightWidth - 4)}`);
  lines.push("");
  lines.push(`  ${DIM}[enter] review & act${R}`);

  return lines;
}

export function renderApprovals(state: ConsoleState, layout: LayoutRegions): string[] {
  const leftWidth = Math.min(Math.max(Math.floor(layout.width * 0.62), 46), layout.width - 22);
  const rightWidth = layout.width - leftWidth - 1;

  const leftLines = buildListLines(state, layout.contentHeight, leftWidth);
  const detailLines = buildDetailLines(state, rightWidth);

  return zipPanes(leftLines, detailLines, leftWidth, rightWidth, layout.contentHeight);
}
