import type { LayoutRegions } from "./types.js";

// ── ANSI escape codes ──────────────────────────────────────────────────────────
export const R = "\x1b[0m";
export const BOLD = "\x1b[1m";
export const DIM = "\x1b[2m";
export const GREEN = "\x1b[32m";
export const YELLOW = "\x1b[33m";
export const RED = "\x1b[31m";
export const CYAN = "\x1b[36m";
export const BLUE = "\x1b[34m";
export const MAGENTA = "\x1b[35m";

// Rows consumed by the fixed shell chrome
const HEADER_ROWS = 2; // title line + separator
const FOOTER_ROWS = 3; // separator + status line + keymap line
const ANSI_RE = /\x1b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\x1b\\))/g;
const graphemeSegmenter = typeof Intl.Segmenter === "function"
  ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
  : null;

export function getLayout(): LayoutRegions {
  const width = Math.max(80, process.stdout.columns ?? 100);
  const height = Math.max(24, process.stdout.rows ?? 30);
  return {
    width,
    height,
    contentHeight: Math.max(6, height - HEADER_ROWS - FOOTER_ROWS),
  };
}

// ── String helpers ─────────────────────────────────────────────────────────────

/** Length of the visible (non-ANSI) portion of a string. */
export function visibleLength(text: string): number {
  return displayWidth(stripAnsi(text));
}

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

function splitGraphemes(text: string): string[] {
  if (!text) return [];
  if (!graphemeSegmenter) return Array.from(text);
  return Array.from(graphemeSegmenter.segment(text), ({ segment }) => segment);
}

function displayWidth(text: string): number {
  let width = 0;
  for (const segment of splitGraphemes(text)) {
    width += graphemeWidth(segment);
  }
  return width;
}

function graphemeWidth(segment: string): number {
  if (!segment) return 0;
  if (/^[\p{Control}\p{Mark}\u200d\uFE0E\uFE0F]+$/u.test(segment)) return 0;
  if (/\p{Extended_Pictographic}/u.test(segment)) return 2;

  const codePoint = segment.codePointAt(0);
  if (codePoint == null) return 0;
  if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) return 0;
  if (isFullwidthCodePoint(codePoint)) return 2;
  return 1;
}

function isFullwidthCodePoint(codePoint: number): boolean {
  return codePoint >= 0x1100 && (
    codePoint <= 0x115f
    || codePoint === 0x2329
    || codePoint === 0x232a
    || (codePoint >= 0x2e80 && codePoint <= 0x3247 && codePoint !== 0x303f)
    || (codePoint >= 0x3250 && codePoint <= 0x4dbf)
    || (codePoint >= 0x4e00 && codePoint <= 0xa4c6)
    || (codePoint >= 0xa960 && codePoint <= 0xa97c)
    || (codePoint >= 0xac00 && codePoint <= 0xd7a3)
    || (codePoint >= 0xf900 && codePoint <= 0xfaff)
    || (codePoint >= 0xfe10 && codePoint <= 0xfe19)
    || (codePoint >= 0xfe30 && codePoint <= 0xfe6b)
    || (codePoint >= 0xff01 && codePoint <= 0xff60)
    || (codePoint >= 0xffe0 && codePoint <= 0xffe6)
    || (codePoint >= 0x1b000 && codePoint <= 0x1b001)
    || (codePoint >= 0x1f200 && codePoint <= 0x1f251)
    || (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  );
}

function truncate(text: string, max: number, ellipsis: boolean): string {
  if (max <= 0) return "";
  if (visibleLength(text) <= max) return text;

  const limit = ellipsis && max > 1 ? max - 1 : max;
  let out = "";
  let visible = 0;
  let lastIndex = 0;
  let sawAnsi = false;

  for (const match of text.matchAll(ANSI_RE)) {
    const start = match.index ?? 0;
    if (start > lastIndex) {
      const chunk = text.slice(lastIndex, start);
      for (const segment of splitGraphemes(chunk)) {
        const width = graphemeWidth(segment);
        if (width > 0 && visible + width > limit) {
          if (ellipsis && max > 1) out += "…";
          if (sawAnsi && !out.endsWith(R)) out += R;
          return out;
        }
        out += segment;
        visible += width;
      }
    }
    out += match[0];
    sawAnsi = true;
    lastIndex = start + match[0].length;
  }

  if (lastIndex < text.length) {
    const chunk = text.slice(lastIndex);
    for (const segment of splitGraphemes(chunk)) {
      const width = graphemeWidth(segment);
      if (width > 0 && visible + width > limit) {
        if (ellipsis && max > 1) out += "…";
        if (sawAnsi && !out.endsWith(R)) out += R;
        return out;
      }
      out += segment;
      visible += width;
    }
  }

  return out;
}

/** Pad to a visible width, appending spaces after any trailing reset codes. */
export function padEnd(text: string, width: number): string {
  const vlen = visibleLength(text);
  if (vlen >= width) return text;
  return text + " ".repeat(width - vlen);
}

/** Clip or pad to an exact visible width without adding ellipsis. */
export function fit(text: string | null | undefined, width: number): string {
  if (width <= 0) return "";
  return padEnd(truncate(text ?? "", width, false), width);
}

/** Clip to a visible width.  ANSI codes are stripped when clipping is needed. */
export function clip(text: string | null | undefined, max: number): string {
  if (max <= 0) return "";
  if (max === 1) return truncate(text ?? "", max, false);
  return truncate(text ?? "", max, true);
}

/** Horizontal rule of a given width. */
export function hr(width: number, char = "─"): string {
  return char.repeat(Math.max(0, width));
}

export function shortId(id: string): string {
  return id.length <= 8 ? id : id.slice(0, 8);
}

export function nowTime(): string {
  return new Date().toTimeString().slice(0, 8);
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "none";
  const mins = Math.floor(ms / (1000 * 60));
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return hours > 0 ? `${hours}h ${remMins}m` : `${remMins}m`;
}

export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return "just now";
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function colorStatus(status: string): string {
  const n = status.toLowerCase();
  if (n === "running" || n === "in_progress") return `${YELLOW}${status}${R}`;
  if (n === "completed" || n === "done") return `${GREEN}${status}${R}`;
  if (n === "failed" || n === "cancelled") return `${RED}${status}${R}`;
  if (n === "approval_pending" || n === "pending") return `${CYAN}${status}${R}`;
  return `${DIM}${status}${R}`;
}

export function sectionHeader(title: string, width: number, meta?: string): string[] {
  const titleText = ` ${BOLD}${title}${R}`;
  const metaSpace = Math.max(0, width - visibleLength(titleText) - 2);
  const metaText = meta && metaSpace > 0 ? `  ${clip(meta, metaSpace)}` : "";
  return [
    `${titleText}${metaText}`,
    `${DIM}${hr(width)}${R}`,
  ];
}

export function sectionDivider(title: string, width: number): string {
  const plain = ` ${title} `;
  if (width <= plain.length) return `${DIM}${hr(width)}${R}`;
  const left = Math.floor((width - plain.length) / 2);
  const right = width - plain.length - left;
  return `${DIM}${hr(left)}${R}${title}${DIM}${hr(right)}${R}`;
}

// ── Split-pane helpers ─────────────────────────────────────────────────────────

/**
 * Combine a left and right content line with a visible separator.
 * `leftWidth` is the visible column width of the left pane.
 */
export function splitLine(left: string, right: string, leftWidth: number, rightWidth: number): string {
  return fit(left, leftWidth) + `${DIM}│${R}` + fit(right, rightWidth);
}

/**
 * Zip two arrays of lines into a split-pane view.
 * Missing lines are treated as empty strings.
 */
export function zipPanes(
  leftLines: string[],
  rightLines: string[],
  leftWidth: number,
  rightWidth: number,
  height?: number,
): string[] {
  const count = height ?? Math.max(leftLines.length, rightLines.length);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push(splitLine(leftLines[i] ?? "", rightLines[i] ?? "", leftWidth, rightWidth));
  }
  return out;
}

export function normalizeLines(lines: string[], height: number, width: number): string[] {
  const normalized = lines.slice(0, height).map((line) => fit(line, width));
  while (normalized.length < height) {
    normalized.push(" ".repeat(Math.max(0, width)));
  }
  return normalized;
}
