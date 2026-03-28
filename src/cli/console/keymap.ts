import type { NavState, NewTaskFocusField } from "./types.js";
import { DIM, R } from "./layout.js";

function key(k: string, label: string): string {
  return `${DIM}[${k}]${R} ${label}`;
}

/**
 * Render a context-sensitive keymap line for the footer.
 * When in the new-task form, shows field-specific hints.
 */
export function renderKeymap(nav: NavState, newTaskFocus?: NewTaskFocusField): string {
  if (nav.detail === "new-task") {
    return renderNewTaskKeymap(newTaskFocus ?? "type");
  }

  const inDetail = nav.detail !== null;
  const isListView =
    !inDetail && (nav.topLevel === "workflows" || nav.topLevel === "approvals");
  const isLogs = !inDetail && nav.topLevel === "logs";

  const parts: string[] = [];

  if (inDetail) {
    parts.push(key("esc", "back"));
    if (nav.detail === "workflow-detail") {
      parts.push(key("↑↓", "scroll"));
      parts.push(key("r", "refresh"));
    } else if (nav.detail === "approval-detail") {
      parts.push(key("↑↓", "scroll"));
      parts.push(key("a", "approve"));
      parts.push(key("r", "reject"));
    }
  } else {
    parts.push(key("o", "overview"));
    parts.push(key("w", "workflows"));
    parts.push(key("a", "approvals"));
    parts.push(key("l", "logs"));
    parts.push(key("n", "new"));
  }

  if (isListView) {
    parts.push(key("↑↓", "select"));
    parts.push(key("enter", "open"));
    if (nav.topLevel === "workflows") {
      parts.push(key("g", "jump active"));
    }
  }

  if (isLogs) {
    parts.push(key("h", "noise"));
    parts.push(key("e", "warn/error"));
    parts.push(key("p", "pause"));
    parts.push(key("c", "clear"));
  }

  parts.push(key("r", "refresh"));
  parts.push(key("q", "quit"));

  return " " + parts.join("  ");
}

function renderNewTaskKeymap(focus: NewTaskFocusField): string {
  const parts: string[] = [];

  switch (focus) {
    case "title":
      parts.push(`${DIM}[chars]${R} type`);
      parts.push(`${DIM}[backspace]${R} del`);
      parts.push(`${DIM}[enter]${R} next`);
      parts.push(`${DIM}[ctrl+enter]${R} submit`);
      break;
    case "type":
    case "mode":
      parts.push(key("← →", "select"));
      parts.push(key("space", "toggle"));
      break;
    case "submit":
      parts.push(key("enter", "submit"));
      break;
  }

  parts.push(key("tab", "next field"));
  parts.push(key("esc", "cancel"));

  return " " + parts.join("  ");
}
