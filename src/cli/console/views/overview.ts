import type { ConsoleState, LayoutRegions } from "../types.js";
import {
  BOLD, DIM, R,
  colorStatus, padEnd, clip, shortId, formatDuration,
} from "../layout.js";

export function renderOverview(state: ConsoleState, layout: LayoutRegions): string[] {
  const lines: string[] = [];

  // ── Runtime stats ────────────────────────────────────────────────────────────
  lines.push(` ${BOLD}RUNTIME${R}`);
  if (!state.status) {
    lines.push(`  ${DIM}loading…${R}`);
  } else {
    const q = state.status.queue ?? {};
    const a = state.status.agents ?? {};
    const h = state.status.heartbeat ?? {};
    lines.push(`  queue    pending=${q.pending ?? 0}  running=${q.running ?? 0}  failed=${q.failed ?? 0}`);
    lines.push(`  agents   total=${a.total ?? 0}  idle=${a.idle ?? 0}  active=${a.running ?? 0}  paused=${a.paused ?? 0}`);
    lines.push(`  hb       scheduled=${h.scheduledCount ?? 0}  next=${formatDuration(h.nextRunMs ?? null)}`);
    lines.push(`  approvals ${DIM}pending=${R}${state.pendingApprovals ?? 0}`);
  }

  lines.push("");

  // ── Recent workflows ─────────────────────────────────────────────────────────
  lines.push(` ${BOLD}RECENT WORKFLOWS${R}  ${DIM}[w] view all${R}`);

  if (state.workflows.length === 0) {
    lines.push(`  ${DIM}no workflow runs yet${R}`);
  } else {
    const w = layout.width - 4;
    // Column widths
    const statusW = 14;
    const typeW = 10;
    const progW = 6;
    const stepW = 18;
    const titleW = Math.max(8, w - statusW - typeW - progW - stepW - 2);

    lines.push(
      `  ${DIM}${"STATUS".padEnd(statusW)}${"TYPE".padEnd(typeW)}${"PROG".padEnd(progW)}${"STEP".padEnd(stepW)}TITLE${R}`,
    );
    lines.push(`  ${DIM}${"-".repeat(Math.min(w, statusW + typeW + progW + stepW + titleW))}${R}`);

    const maxRows = Math.max(1, layout.contentHeight - lines.length - 1);
    for (const wf of state.workflows.slice(0, maxRows)) {
      try {
        const prog = `${wf.progress?.completed ?? 0}/${wf.progress?.total ?? 0}`;
        const title = clip(wf.issueTitle ?? shortId(wf.id), titleW);
        const statusStr = padEnd(colorStatus(clip(wf.status ?? "", statusW)), statusW);
        const step = clip(wf.currentStepKey ?? "—", stepW);
        const typeStr = (wf.type ?? "").padEnd(typeW);
        lines.push(`  ${statusStr}${typeStr}${prog.padEnd(progW)}${step.padEnd(stepW)}${title}`);
      } catch {
        lines.push(`  ${DIM}${shortId(wf.id)}${R}`);
      }
    }
  }

  return lines;
}
