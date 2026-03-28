import type { ApprovalDetail, ApprovalSummary, ConsoleState, LayoutRegions } from "../types.js";
import {
  BOLD, CYAN, DIM, GREEN, RED, YELLOW, R,
  clip, fit, colorStatus, formatRelativeTime, hr, shortId, sectionDivider, sectionHeader,
} from "../layout.js";

function currentApproval(state: ConsoleState): ApprovalDetail | ApprovalSummary | null {
  if (state.approvalDetail && state.approvalDetail.id === state.nav.detailId) {
    return state.approvalDetail;
  }
  return state.approvals.find((ap) => ap.id === state.nav.detailId) ?? null;
}

function buildActionLines(detail: ApprovalDetail | null, width: number): string[] {
  if (!detail) return [];

  const lines: string[] = [];
  lines.push(sectionDivider("DECISION", width));

  if (detail.status !== "pending" || detail.availableActions.length === 0) {
    lines.push(`  ${DIM}This approval is already ${detail.status}.${R}`);
    return lines;
  }

  if (detail.decisionHint) {
    lines.push(`  ${clip(detail.decisionHint, 120)}`);
    lines.push("");
  }

  for (const action of detail.availableActions) {
    const color = action.key === "a" ? GREEN : RED;
    const key = `${color}[${action.key}]${R}`;
    lines.push(`  ${key} ${fit(action.label, 8)} ${clip(action.description, 100)}`);
  }

  return lines;
}

export function renderApprovalDetail(state: ConsoleState, layout: LayoutRegions): string[] {
  const all: string[] = [];
  const approval = currentApproval(state);
  const detail = state.approvalDetail && state.approvalDetail.id === state.nav.detailId
    ? state.approvalDetail
    : null;

  const id = approval?.id ?? state.nav.detailId ?? "—";
  const type = approval?.type ?? "—";
  const status = approval?.status ?? "—";
  const title = detail?.title ?? approval?.title ?? approval?.description ?? shortId(id);
  const description = detail?.description ?? approval?.description ?? null;
  const reason = detail?.reason ?? approval?.reason ?? null;
  const summary = detail?.summary ?? approval?.summary ?? null;
  const requestedBy = detail?.requestedBy ?? approval?.requestedBy ?? null;
  const requestedAt = detail?.requestedAt ?? approval?.requestedAt ?? null;
  const reviewedAt = detail?.reviewedAt ?? approval?.reviewedAt ?? null;
  const stepKey = detail?.stepKey ?? approval?.stepKey ?? null;
  const agentSlug = detail?.agentSlug ?? approval?.agentSlug ?? null;

  all.push(...sectionHeader("APPROVAL INSPECTOR", layout.width));

  const lw = 11;
  all.push(`  ${DIM}${"id".padEnd(lw)}${R}${shortId(id)}`);
  all.push(`  ${DIM}${"type".padEnd(lw)}${R}${type}`);
  all.push(`  ${DIM}${"status".padEnd(lw)}${R}${colorStatus(status)}${R}`);
  if (requestedBy) all.push(`  ${DIM}${"requested".padEnd(lw)}${R}${requestedBy}`);
  if (requestedAt) all.push(`  ${DIM}${"opened".padEnd(lw)}${R}${formatRelativeTime(requestedAt)}`);
  if (reviewedAt) all.push(`  ${DIM}${"reviewed".padEnd(lw)}${R}${formatRelativeTime(reviewedAt)}`);
  if (stepKey) all.push(`  ${DIM}${"step".padEnd(lw)}${R}${stepKey}`);
  if (agentSlug) all.push(`  ${DIM}${"agent".padEnd(lw)}${R}@${agentSlug}`);

  all.push("");
  all.push(`  "${clip(title, layout.width - 6)}"`);
  if (description && description !== title) {
    all.push(`  ${DIM}${clip(description, layout.width - 6)}${R}`);
  }
  if (reason) {
    all.push("");
    all.push(`  ${YELLOW}! ${clip(reason, layout.width - 6)}${R}`);
  }
  if (summary) {
    all.push(`  ${DIM}${clip(summary, layout.width - 6)}${R}`);
  }

  if (state.approvalDetailLoading && !detail) {
    all.push("");
    all.push(`  ${DIM}Loading approval context…${R}`);
  }

  if (state.approvalDetailError && !detail) {
    all.push("");
    all.push(`  ${RED}${clip(state.approvalDetailError, layout.width - 4)}${R}`);
  }

  if (detail?.workflow) {
    all.push("");
    all.push(sectionDivider("WORKFLOW CONTEXT", layout.width));
    all.push(`  ${DIM}${"workflow".padEnd(lw)}${R}${shortId(detail.workflow.id)}  ${colorStatus(detail.workflow.status)}${R}`);
    if (detail.workflow.sprintNumber != null) {
      all.push(`  ${DIM}${"sprint".padEnd(lw)}${R}${detail.workflow.sprintNumber}`);
    }
    if (detail.workflow.currentStepKey) {
      all.push(`  ${DIM}${"current".padEnd(lw)}${R}${detail.workflow.currentStepKey}`);
    }
    if (detail.workflow.stepAgentSlug) {
      const stepStatusText = detail.workflow.stepStatus ? `  (${detail.workflow.stepStatus})` : "";
      all.push(`  ${DIM}${"step owner".padEnd(lw)}${R}@${detail.workflow.stepAgentSlug}${stepStatusText}`);
    } else if (detail.workflow.entryAgentSlug) {
      all.push(`  ${DIM}${"entry".padEnd(lw)}${R}@${detail.workflow.entryAgentSlug}`);
    }
    if (detail.workflow.issue?.title) {
      all.push(`  ${DIM}${"issue".padEnd(lw)}${R}${clip(detail.workflow.issue.title, layout.width - lw - 4)}`);
    }
  }

  if (detail?.criterion) {
    all.push("");
    all.push(`  ${DIM}${"criterion".padEnd(lw)}${R}${clip(detail.criterion, layout.width - lw - 4)}`);
  }

  if (detail?.note) {
    all.push("");
    all.push(sectionDivider("OPERATOR NOTE", layout.width));
    all.push(`  ${clip(detail.note, layout.width - 4)}`);
  }

  if (detail?.contextLines.length) {
    all.push("");
    all.push(sectionDivider("GATE CONTEXT", layout.width));
    for (const line of detail.contextLines) {
      all.push(`  ${DIM}${line.label.padEnd(lw)}${R}${clip(line.value, layout.width - lw - 4)}`);
    }
  }

  if (detail) {
    all.push("");
    all.push(...buildActionLines(detail, layout.width));
  }

  if (state.approvalActionLoading) {
    all.push("");
    all.push(`  ${DIM}Applying decision…${R}`);
  }

  all.push("");

  const maxOffset = Math.max(0, all.length - layout.contentHeight);
  if (state.detailScrollOffset > maxOffset) {
    state.detailScrollOffset = maxOffset;
  }
  const offset = state.detailScrollOffset;
  return all.slice(offset, offset + layout.contentHeight);
}
