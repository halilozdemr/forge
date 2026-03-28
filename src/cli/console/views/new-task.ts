import type { ConsoleState, LayoutRegions } from "../types.js";
import {
  BOLD, DIM, GREEN, YELLOW, RED, CYAN, R,
  fit, clip, sectionHeader,
} from "../layout.js";

/**
 * New Task interactive form.
 *
 * Fields:  type → title → mode → submit
 * Active field: CYAN border + label
 * Inactive field: DIM border
 */
export function renderNewTask(state: ConsoleState, layout: LayoutRegions): string[] {
  const form = state.newTaskForm;
  const lines: string[] = [];

  const fieldW = Math.min(layout.width - 8, 80);
  const lm = " ".repeat(4);
  const innerW = fieldW - 2; // interior width (between │ chars)

  // ── Helpers ────────────────────────────────────────────────────────────────

  function sectionLabel(text: string, focused: boolean): string {
    return `${lm}${focused ? CYAN : DIM}${text}${R}`;
  }

  function topBorder(focused: boolean): string {
    const b = focused ? CYAN : DIM;
    return `${lm}${b}┌${"─".repeat(fieldW - 2)}┐${R}`;
  }

  function botBorder(focused: boolean): string {
    const b = focused ? CYAN : DIM;
    return `${lm}${b}└${"─".repeat(fieldW - 2)}┘${R}`;
  }

  function row(content: string, focused: boolean): string {
    const b = focused ? CYAN : DIM;
    return `${lm}${b}│${R}${fit(content, innerW)}${b}│${R}`;
  }

  // ── Header ─────────────────────────────────────────────────────────────────
  for (const line of sectionHeader("NEW TASK", fieldW)) {
    lines.push(`${lm}${line}`);
  }
  lines.push(`${lm}${DIM}${clip("[tab] next  [esc] back  [ctrl+enter] submit", fieldW)}${R}`);
  lines.push(`${lm}${DIM}${clip("capture the work request, then choose execution mode", fieldW)}${R}`);
  lines.push("");

  // ── Work type ──────────────────────────────────────────────────────────────
  const typeFocus = form.focusField === "type";
  lines.push(sectionLabel("WORK TYPE", typeFocus));
  lines.push(topBorder(typeFocus));

  const featureChk = form.workType === "feature" ? `${GREEN}[●]${R}` : `${DIM}[ ]${R}`;
  const bugChk     = form.workType === "bug"     ? `${GREEN}[●]${R}` : `${DIM}[ ]${R}`;
  const typeHint   = typeFocus ? `   ${DIM}← → or space to toggle${R}` : "";
  lines.push(row(`  ${featureChk} feature      ${bugChk} bug${typeHint}`, typeFocus));
  lines.push(botBorder(typeFocus));

  // ── Title ──────────────────────────────────────────────────────────────────
  const titleFocus = form.focusField === "title";
  lines.push(sectionLabel("TASK TITLE", titleFocus));
  lines.push(topBorder(titleFocus));

  const maxTitleVis = innerW - 4; // " > " (3) + cursor/trailing space (1)
  const cursor = titleFocus ? "▌" : " ";
  const rawTitle = form.title.length > 0
    ? clip(form.title, maxTitleVis - 1) + cursor
    : cursor;
  const titlePrefix = titleFocus ? `${CYAN}>${R} ` : `${DIM}>${R} `;
  lines.push(row(` ${titlePrefix}${rawTitle}`, titleFocus));
  lines.push(botBorder(titleFocus));

  // ── Execution mode ─────────────────────────────────────────────────────────
  const modeFocus = form.focusField === "mode";
  lines.push(sectionLabel("EXECUTION MODE", modeFocus));
  lines.push(topBorder(modeFocus));

  const fastChk   = form.executionMode === "fast"       ? `${GREEN}[●]${R}` : `${DIM}[ ]${R}`;
  const structChk = form.executionMode === "structured"  ? `${GREEN}[●]${R}` : `${DIM}[ ]${R}`;
  const modeHint  = modeFocus ? `   ${DIM}← → or space to toggle${R}` : "";
  lines.push(row(`  ${fastChk} fast         ${structChk} structured${modeHint}`, modeFocus));
  lines.push(row(`      ${DIM}Quick iter.       Planned w/ checkpoints${R}`, modeFocus));
  lines.push(botBorder(modeFocus));

  // ── Submit ─────────────────────────────────────────────────────────────────
  const submitFocus = form.focusField === "submit";
  lines.push(topBorder(submitFocus));

  if (form.submitting) {
    lines.push(row(`  ${YELLOW}Submitting…${R}`, submitFocus));
  } else {
    const submitLabel = submitFocus ? `${CYAN}${BOLD}SUBMIT TASK${R}` : `${BOLD}SUBMIT TASK${R}`;
    const hint = submitFocus ? `   ${DIM}[enter]${R}` : "";
    lines.push(row(`  ${submitLabel}${hint}`, submitFocus));
  }

  lines.push(botBorder(submitFocus));

  // ── Error ──────────────────────────────────────────────────────────────────
  if (form.submitError) {
    lines.push(`${lm}${RED}✗ ${form.submitError}${R}`);
  }

  return lines;
}
