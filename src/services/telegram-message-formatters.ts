/**
 * Telegram message formatters for pipeline notifications
 * Provides rich Markdown-formatted messages with detailed context
 */

export interface NotificationContext {
  pipelineId: string;
  issueTitle?: string | null;
  pipelineStage?: string | null;
  durationSeconds?: number | null;
  errorReason?: string | null;
}

/**
 * Formats a pipeline start notification with rich context
 * Uses Markdown formatting for professional visual hierarchy
 */
export function formatPipelineStartNotification(
  context: NotificationContext
): { message: string; parseMode: "Markdown" } {
  const { pipelineId, issueTitle, pipelineStage } = context;

  let message = "*🚀 Pipeline Started*\n";
  message += "─".repeat(40) + "\n\n";

  if (issueTitle) {
    message += `*Issue:* ${escapeMarkdown(issueTitle)}\n`;
  }

  message += `*Pipeline ID:* \`${pipelineId}\`\n`;

  if (pipelineStage) {
    message += `*Stage:* ${escapeMarkdown(pipelineStage)}\n`;
  }

  return {
    message,
    parseMode: "Markdown",
  };
}

/**
 * Formats a pipeline success notification with rich context
 * Uses Markdown formatting with visual success indicators
 */
export function formatPipelineSuccessNotification(
  context: NotificationContext
): { message: string; parseMode: "Markdown" } {
  const { pipelineId, issueTitle, pipelineStage, durationSeconds } = context;

  let message = "*✅ Pipeline Completed Successfully*\n";
  message += "─".repeat(40) + "\n\n";

  if (issueTitle) {
    message += `*Issue:* ${escapeMarkdown(issueTitle)}\n`;
  }

  message += `*Pipeline ID:* \`${pipelineId}\`\n`;

  if (pipelineStage) {
    message += `*Final Stage:* ${escapeMarkdown(pipelineStage)}\n`;
  }

  if (durationSeconds !== null && durationSeconds !== undefined) {
    const duration = formatDuration(durationSeconds);
    message += `*Duration:* ${duration}\n`;
  }

  message += "\n_All stages completed without errors._";

  return {
    message,
    parseMode: "Markdown",
  };
}

/**
 * Formats a pipeline failure notification with rich context and error details
 * Uses Markdown formatting with visual failure indicators
 */
export function formatPipelineFailureNotification(
  context: NotificationContext
): { message: string; parseMode: "Markdown" } {
  const { pipelineId, issueTitle, pipelineStage, errorReason } = context;

  let message = "*❌ Pipeline Failed*\n";
  message += "─".repeat(40) + "\n\n";

  if (issueTitle) {
    message += `*Issue:* ${escapeMarkdown(issueTitle)}\n`;
  }

  message += `*Pipeline ID:* \`${pipelineId}\`\n`;

  if (pipelineStage) {
    message += `*Failed At Stage:* ${escapeMarkdown(pipelineStage)}\n`;
  }

  if (errorReason) {
    message += "\n*Error Details:*\n";
    // Truncate and escape error message for readability
    const truncatedError =
      errorReason.length > 300
        ? `${errorReason.substring(0, 300)}...`
        : errorReason;
    message += "```\n";
    message += escapeMarkdownCode(truncatedError);
    message += "\n```\n";
  } else {
    message += "\n*No error details available.*\n";
  }

  message +=
    "\n_Review the pipeline logs for more information on the failure._";

  return {
    message,
    parseMode: "Markdown",
  };
}

/**
 * Escapes special Markdown characters in text
 * Prevents formatting conflicts while preserving readability
 * Only escapes characters that could interfere with formatting
 */
function escapeMarkdown(text: string): string {
  if (!text) return "";
  // Escape only characters that could interfere with Markdown formatting
  // Don't escape hyphens as they're commonly used in words
  return text
    .replace(/[_*\[\]()~`>#+=|{}.!\\]/g, "\\$&")
    .trim();
}

/**
 * Escapes text for use in Markdown code blocks
 * Code blocks have fewer escape requirements than inline text
 */
function escapeMarkdownCode(text: string): string {
  if (!text) return "";
  // For code blocks, just ensure we don't have triple backticks
  return text.replace(/```/g, "` ` `");
}

/**
 * Formats duration in seconds to a human-readable string
 * Examples: "5s", "1m 30s", "2h 15m"
 */
export function formatDuration(seconds: number): string {
  if (seconds < 0) return "N/A";

  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);

  if (minutes < 60) {
    return remainingSeconds > 0
      ? `${minutes}m ${remainingSeconds}s`
      : `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  return remainingMinutes > 0
    ? `${hours}h ${remainingMinutes}m`
    : `${hours}h`;
}
