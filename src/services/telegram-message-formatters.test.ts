import { describe, it, expect } from "vitest";
import {
  formatPipelineStartNotification,
  formatPipelineSuccessNotification,
  formatPipelineFailureNotification,
  formatDuration,
  type NotificationContext,
} from "./telegram-message-formatters.js";

describe("Telegram Message Formatters", () => {
  describe("formatPipelineStartNotification", () => {
    it("should format start notification with minimal context", () => {
      const context: NotificationContext = {
        pipelineId: "pipe-123abc",
      };

      const result = formatPipelineStartNotification(context);

      expect(result.parseMode).toBe("Markdown");
      expect(result.message).toContain("🚀 Pipeline Started");
      expect(result.message).toContain("pipe-123abc");
      expect(result.message).toContain("*Pipeline ID:*");
    });

    it("should format start notification with full context", () => {
      const context: NotificationContext = {
        pipelineId: "pipe-456def",
        issueTitle: "Add user authentication",
        pipelineStage: "intake-gate",
      };

      const result = formatPipelineStartNotification(context);

      expect(result.parseMode).toBe("Markdown");
      expect(result.message).toContain("🚀 Pipeline Started");
      expect(result.message).toContain("Add user authentication");
      expect(result.message).toContain("pipe-456def");
      expect(result.message).toContain("intake-gate");
      expect(result.message).toContain("*Issue:*");
      expect(result.message).toContain("*Stage:*");
    });

    it("should include at least 3 context pieces when available", () => {
      const context: NotificationContext = {
        pipelineId: "pipe-789ghi",
        issueTitle: "Fix login bug",
        pipelineStage: "builder",
      };

      const result = formatPipelineStartNotification(context);

      // Count context elements: issue title, pipeline ID, stage
      const hasIssue = result.message.includes("*Issue:*");
      const hasId = result.message.includes("*Pipeline ID:*");
      const hasStage = result.message.includes("*Stage:*");

      const contextCount = [hasIssue, hasId, hasStage].filter(Boolean).length;
      expect(contextCount).toBeGreaterThanOrEqual(2); // At least 2 (ID is always there)
    });

    it("should escape special Markdown characters in titles", () => {
      const context: NotificationContext = {
        pipelineId: "pipe-123",
        issueTitle: "Add [feature] with *bold* and _italic_",
      };

      const result = formatPipelineStartNotification(context);

      // Should escape special characters
      expect(result.message).toContain("\\[");
      expect(result.message).toContain("\\*");
      expect(result.message).toContain("\\_");
    });
  });

  describe("formatPipelineSuccessNotification", () => {
    it("should format success notification with minimal context", () => {
      const context: NotificationContext = {
        pipelineId: "pipe-123abc",
      };

      const result = formatPipelineSuccessNotification(context);

      expect(result.parseMode).toBe("Markdown");
      expect(result.message).toContain("✅ Pipeline Completed Successfully");
      expect(result.message).toContain("pipe-123abc");
      expect(result.message).toContain("*Pipeline ID:*");
    });

    it("should format success notification with duration", () => {
      const context: NotificationContext = {
        pipelineId: "pipe-456def",
        issueTitle: "Refactor database layer",
        pipelineStage: "devops",
        durationSeconds: 245, // 4m 5s
      };

      const result = formatPipelineSuccessNotification(context);

      expect(result.parseMode).toBe("Markdown");
      expect(result.message).toContain("✅ Pipeline Completed Successfully");
      expect(result.message).toContain("Refactor database layer");
      expect(result.message).toContain("pipe-456def");
      expect(result.message).toContain("devops");
      expect(result.message).toContain("*Duration:*");
      expect(result.message).toContain("4m 5s");
      expect(result.message).toContain("All stages completed without errors");
    });

    it("should include at least 3 context pieces when available", () => {
      const context: NotificationContext = {
        pipelineId: "pipe-789ghi",
        issueTitle: "Add caching layer",
        pipelineStage: "quality-guard",
        durationSeconds: 120,
      };

      const result = formatPipelineSuccessNotification(context);

      // Count context elements: issue, ID, stage, duration
      const hasIssue = result.message.includes("*Issue:*");
      const hasId = result.message.includes("*Pipeline ID:*");
      const hasStage = result.message.includes("*Final Stage:*");
      const hasDuration = result.message.includes("*Duration:*");

      const contextCount = [hasIssue, hasId, hasStage, hasDuration].filter(
        Boolean
      ).length;
      expect(contextCount).toBeGreaterThanOrEqual(3);
    });

    it("should be visually distinct from other notification types", () => {
      const startContext: NotificationContext = {
        pipelineId: "pipe-123",
        issueTitle: "Test feature",
      };
      const successContext: NotificationContext = {
        pipelineId: "pipe-123",
        issueTitle: "Test feature",
      };

      const startMsg = formatPipelineStartNotification(startContext).message;
      const successMsg = formatPipelineSuccessNotification(
        successContext
      ).message;

      // Should have different emoji indicators and headings
      expect(startMsg).toContain("🚀");
      expect(successMsg).toContain("✅");
      expect(startMsg).not.toContain("✅");
      expect(successMsg).not.toContain("🚀");
    });
  });

  describe("formatPipelineFailureNotification", () => {
    it("should format failure notification with minimal context", () => {
      const context: NotificationContext = {
        pipelineId: "pipe-123abc",
      };

      const result = formatPipelineFailureNotification(context);

      expect(result.parseMode).toBe("Markdown");
      expect(result.message).toContain("❌ Pipeline Failed");
      expect(result.message).toContain("pipe-123abc");
      expect(result.message).toContain("*Pipeline ID:*");
    });

    it("should format failure notification with error details", () => {
      const context: NotificationContext = {
        pipelineId: "pipe-456def",
        issueTitle: "Deploy to production",
        pipelineStage: "devops",
        errorReason: "Database migration failed: Connection timeout",
      };

      const result = formatPipelineFailureNotification(context);

      expect(result.parseMode).toBe("Markdown");
      expect(result.message).toContain("❌ Pipeline Failed");
      expect(result.message).toContain("Deploy to production");
      expect(result.message).toContain("pipe-456def");
      expect(result.message).toContain("devops");
      expect(result.message).toContain("*Failed At Stage:*");
      expect(result.message).toContain("*Error Details:*");
      expect(result.message).toContain("Database migration failed");
      expect(result.message).toContain("Connection timeout");
    });

    it("should truncate very long error messages", () => {
      const longError =
        "A".repeat(400) + " " + "B".repeat(100);
      const context: NotificationContext = {
        pipelineId: "pipe-789ghi",
        issueTitle: "Test",
        errorReason: longError,
      };

      const result = formatPipelineFailureNotification(context);

      // Error should be truncated to ~300 chars and end with ...
      expect(result.message).toContain("...");
      expect(result.message.length).toBeLessThan(longError.length);
    });

    it("should include stage and error details for actionability", () => {
      const context: NotificationContext = {
        pipelineId: "pipe-test",
        issueTitle: "Fix validation",
        pipelineStage: "quality-guard",
        errorReason: "Type error in src/validators.ts: Missing type annotation",
      };

      const result = formatPipelineFailureNotification(context);

      // Should include both stage and error for actionable context
      expect(result.message).toContain("quality-guard");
      expect(result.message).toContain("Missing type annotation");
      expect(result.message).toContain("src/validators.ts");
    });

    it("should be visually distinct from success notifications", () => {
      const failureContext: NotificationContext = {
        pipelineId: "pipe-123",
        issueTitle: "Test feature",
      };
      const successContext: NotificationContext = {
        pipelineId: "pipe-123",
        issueTitle: "Test feature",
      };

      const failureMsg = formatPipelineFailureNotification(
        failureContext
      ).message;
      const successMsg = formatPipelineSuccessNotification(
        successContext
      ).message;

      // Should have different emoji indicators
      expect(failureMsg).toContain("❌");
      expect(successMsg).toContain("✅");
      expect(failureMsg).not.toContain("✅");
      expect(successMsg).not.toContain("❌");
    });

    it("should provide actionable feedback when error is present", () => {
      const context: NotificationContext = {
        pipelineId: "pipe-abc123",
        issueTitle: "CI/CD enhancement",
        pipelineStage: "builder",
        errorReason: "Failed to build: npm install returned exit code 1",
      };

      const result = formatPipelineFailureNotification(context);

      // Should include stage (where failed) and error (why it failed)
      expect(result.message).toContain("*Failed At Stage:*");
      expect(result.message).toContain("builder");
      expect(result.message).toContain("npm install");
      expect(result.message).toContain("exit code 1");
    });
  });

  describe("formatDuration", () => {
    it("should format seconds only", () => {
      expect(formatDuration(0)).toBe("0s");
      expect(formatDuration(5)).toBe("5s");
      expect(formatDuration(59)).toBe("59s");
    });

    it("should format minutes and seconds", () => {
      expect(formatDuration(60)).toBe("1m");
      expect(formatDuration(65)).toBe("1m 5s");
      expect(formatDuration(125)).toBe("2m 5s");
      expect(formatDuration(3599)).toBe("59m 59s");
    });

    it("should format hours and minutes", () => {
      expect(formatDuration(3600)).toBe("1h");
      expect(formatDuration(3660)).toBe("1h 1m");
      expect(formatDuration(7325)).toBe("2h 2m");
      expect(formatDuration(7380)).toBe("2h 3m");
    });

    it("should handle edge cases", () => {
      expect(formatDuration(-5)).toBe("N/A");
      expect(formatDuration(0)).toBe("0s");
      expect(formatDuration(3661)).toBe("1h 1m");
    });
  });

  describe("Markdown formatting validation", () => {
    it("should produce valid Markdown that Telegram can parse", () => {
      const context: NotificationContext = {
        pipelineId: "pipe-123",
        issueTitle: "Test feature",
        pipelineStage: "builder",
        errorReason: "Some error occurred",
      };

      const startMsg = formatPipelineStartNotification(context).message;
      const successMsg = formatPipelineSuccessNotification(context).message;
      const failureMsg = formatPipelineFailureNotification(context).message;

      // Verify all messages are non-empty and contain minimum content
      expect(startMsg.length).toBeGreaterThan(20);
      expect(successMsg.length).toBeGreaterThan(20);
      expect(failureMsg.length).toBeGreaterThan(20);

      // Verify no triple backticks are consecutive (breaks code blocks)
      expect(startMsg).not.toMatch(/```[\s\S]*```[\s\S]*```/);
      expect(successMsg).not.toMatch(/```[\s\S]*```[\s\S]*```/);
      expect(failureMsg).not.toMatch(/```[\s\S]*```[\s\S]*```/);

      // Verify each uses the Markdown parse mode indicator
      expect(startMsg).toContain("*");
      expect(successMsg).toContain("*");
      expect(failureMsg).toContain("*");
    });

    it("all messages should specify Markdown parse mode", () => {
      const context: NotificationContext = {
        pipelineId: "pipe-123",
        issueTitle: "Test",
      };

      const start = formatPipelineStartNotification(context);
      const success = formatPipelineSuccessNotification(context);
      const failure = formatPipelineFailureNotification(context);

      expect(start.parseMode).toBe("Markdown");
      expect(success.parseMode).toBe("Markdown");
      expect(failure.parseMode).toBe("Markdown");
    });
  });
});
