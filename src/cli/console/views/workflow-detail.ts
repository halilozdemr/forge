import type { ConsoleState, LayoutRegions, WorkflowStep } from "../types.js";
import {
  BOLD, CYAN, DIM, GREEN, RED, YELLOW, R,
  colorStatus, clip, hr, shortId, formatRelativeTime,
} from "../layout.js";

// ── Step timeline column widths ────────────────────────────────────────────────
const STEP_KEY_W  = 20;
const AGENT_W     = 14;
const STEP_STAT_W = 14;
const STEP_TIME_W =  7;

// ── Step helpers ──────────────────────────────────────────────────────────────

function stepIndicator(status: string, attempts: number): string {
  const s = (status ?? "").toLowerCase();
  if (s === "completed" || s === "done")    return "[+]";
  if (s === "running" || s === "in_progress") return attempts > 1 ? "[~]" : "[>]";
  if (s === "failed")                       return "[!]";
  if (s === "approval_pending")             return "[?]";
  if (s === "cancelled")                    return "[x]";
  return "[-]"; // pending / unknown
}

function stepDuration(step: WorkflowStep): string {
  if (!step.startedAt) return "—";
  const start = new Date(step.startedAt).getTime();
  const end   = step.completedAt ? new Date(step.completedAt).getTime() : Date.now();
  const secs  = Math.floor((end - start) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins  = Math.floor(secs / 60);
  return `${mins}m${String(secs % 60).padStart(2, "0")}s`;
}

/**
 * 3-tier row coloring — mirrors the pattern used in the workflow list:
 *
 *   Active (running/failed/approval_pending)
 *       → colored indicator + DEFAULT text for rest of row
 *   Completed
 *       → full DIM (indicator is plain ASCII "[+]", no embedded R, so DIM is uniform)
 *   Pending / cancelled / unknown
 *       → full DIM (same rationale)
 */
function buildStepRow(step: WorkflowStep): string {
  const ind  = stepIndicator(step.status, step.attempts);
  const key  = clip(step.stepKey, STEP_KEY_W).padEnd(STEP_KEY_W);
  const ag   = clip(`@${step.agentSlug}`, AGENT_W).padEnd(AGENT_W);
  const stat = clip(step.status ?? "pending", STEP_STAT_W).padEnd(STEP_STAT_W);
  const time = stepDuration(step).padEnd(STEP_TIME_W);

  const s = (step.status ?? "").toLowerCase();

  if (s === "running" || s === "in_progress") {
    const colored = step.attempts > 1 ? `${YELLOW}[~]${R}` : `${YELLOW}[>]${R}`;
    return `  ${colored} ${key}${ag}${stat}${time}`;
  }
  if (s === "failed") {
    return `  ${RED}${ind}${R} ${key}${ag}${stat}${time}`;
  }
  if (s === "approval_pending") {
    return `  ${CYAN}${ind}${R} ${key}${ag}${stat}${time}`;
  }
  if (s === "completed" || s === "done") {
    // Plain DIM — no embedded ANSI inside, so DIM applies uniformly
    return `${DIM}  ${ind} ${key}${ag}${stat}${time}${R}`;
  }
  // pending / cancelled / unknown
  return `${DIM}  ${ind} ${key}${ag}${stat}${time}${R}`;
}

// ── Entry point ───────────────────────────────────────────────────────────────

export function renderWorkflowDetail(state: ConsoleState, layout: LayoutRegions): string[] {
  const all: string[] = [];

  // Use cached list-data for immediate display; swap to richer detail when loaded.
  const summaryWf = state.workflows.find((w) => w.id === state.nav.detailId) ?? null;
  const detail    = state.workflowDetail;

  const id          = detail?.id          ?? state.nav.detailId ?? "—";
  const type        = detail?.type        ?? summaryWf?.type    ?? "—";
  const status      = detail?.status      ?? summaryWf?.status  ?? "—";
  const currentStep = detail?.currentStepKey ?? summaryWf?.currentStepKey ?? null;
  const progress    = detail?.progress    ?? summaryWf?.progress ?? null;
  const issueTitle  = detail?.issue?.title ?? summaryWf?.issueTitle ?? null;
  const lastError   = detail?.lastError   ?? summaryWf?.lastError  ?? null;
  const createdAt   = detail?.createdAt   ?? summaryWf?.createdAt  ?? null;

  // ── Header ────────────────────────────────────────────────────────────────
  all.push(` ${BOLD}WORKFLOW INSPECTOR${R}`);
  all.push(`${DIM}${hr(layout.width)}${R}`);

  const lw = 11; // label column width
  all.push(`  ${DIM}${"id".padEnd(lw)}${R}${shortId(id)}`);
  all.push(`  ${DIM}${"type".padEnd(lw)}${R}${type}`);
  all.push(`  ${DIM}${"status".padEnd(lw)}${R}${colorStatus(status)}${R}`);

  const prog = progress ? `${progress.completed}/${progress.total} steps` : null;
  if (currentStep || prog) {
    const val = [currentStep, prog ? `(${prog})` : null].filter(Boolean).join("  ");
    all.push(`  ${DIM}${"step".padEnd(lw)}${R}${val}`);
  }

  if (createdAt) {
    all.push(`  ${DIM}${"created".padEnd(lw)}${R}${formatRelativeTime(createdAt)}`);
  }
  if (detail?.startedAt) {
    all.push(`  ${DIM}${"started".padEnd(lw)}${R}${formatRelativeTime(detail.startedAt)}`);
  }
  if (detail?.completedAt) {
    all.push(`  ${DIM}${"completed".padEnd(lw)}${R}${formatRelativeTime(detail.completedAt)}`);
  }

  if (issueTitle) {
    all.push("");
    all.push(`  "${clip(issueTitle, layout.width - 6)}"`);
  }

  if (lastError && (status ?? "").toLowerCase() === "failed") {
    all.push("");
    all.push(`  ${RED}! ${clip(lastError, layout.width - 6)}${R}`);
  }

  // ── Steps ─────────────────────────────────────────────────────────────────
  all.push("");
  all.push(`${DIM}${hr(layout.width)}${R}`);

  if (state.workflowDetailLoading && !detail) {
    // Show loading only when no data at all yet
    all.push(`  ${DIM}Loading steps…${R}`);
  } else if (state.workflowDetailError && !detail) {
    all.push(`  ${RED}${clip(state.workflowDetailError, layout.width - 4)}${R}`);
    all.push(`  ${DIM}[r] retry${R}`);
  } else if (detail) {
    if (detail.steps.length === 0) {
      all.push(`  ${DIM}no steps recorded${R}`);
    } else {
      // Column header
      all.push(
        `  ${DIM}    ` +
        `${"STEP".padEnd(STEP_KEY_W)}` +
        `${"AGENT".padEnd(AGENT_W)}` +
        `${"STATUS".padEnd(STEP_STAT_W)}` +
        `TIME${R}`,
      );
      all.push(`  ${DIM}${hr(layout.width - 4)}${R}`);

      for (const step of detail.steps) {
        all.push(buildStepRow(step));
      }

      // Surface result summary for failed steps
      const failedWithSummary = detail.steps.filter(
        (s) => s.status === "failed" && s.resultSummary,
      );
      if (failedWithSummary.length > 0) {
        all.push("");
        for (const step of failedWithSummary) {
          const label = `  ${RED}! ${step.stepKey}${R}  `;
          const msgW  = Math.max(4, layout.width - step.stepKey.length - 10);
          all.push(label + `${DIM}${clip(step.resultSummary ?? "", msgW)}${R}`);
        }
      }
    }
  }

  all.push("");

  // ── Scroll: clamp offset and slice ────────────────────────────────────────
  const maxOffset = Math.max(0, all.length - layout.contentHeight);
  if (state.detailScrollOffset > maxOffset) {
    state.detailScrollOffset = maxOffset; // clamp in-place during render
  }
  const offset = state.detailScrollOffset;
  return all.slice(offset, offset + layout.contentHeight);
}
