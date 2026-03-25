export const LIVE_SUMMARY_MAX_CHARS = 1600;
const ANSI_ESCAPE_PATTERN = /\u001b\[[0-9;]*m/g;

export function sanitizeStreamChunk(chunk: string): string {
  return chunk.replace(ANSI_ESCAPE_PATTERN, "").replace(/\r/g, "");
}

/**
 * Extract human-readable text from a stream-json line.
 * If the line is a stream-json event, returns the text content.
 * Otherwise returns the line as-is.
 */
export function extractStreamJsonText(line: string): string | null {
  if (!line.startsWith("{")) return line;
  try {
    const event = JSON.parse(line) as Record<string, unknown>;
    if (event.type === "result" || event.type === "system") return null;
    if (event.type === "assistant") {
      const msg = event.message as Record<string, unknown> | undefined;
      const content = msg?.content;
      if (Array.isArray(content)) {
        const texts = content
          .filter((c: any) => c.type === "text")
          .map((c: any) => c.text as string)
          .join("");
        return texts || null;
      }
    }
    return null;
  } catch {
    return line;
  }
}

export function appendLiveBuffer(buffer: string, chunk: string): string {
  const next = `${buffer}${chunk}`;
  return next.length > LIVE_SUMMARY_MAX_CHARS
    ? next.slice(next.length - LIVE_SUMMARY_MAX_CHARS)
    : next;
}
