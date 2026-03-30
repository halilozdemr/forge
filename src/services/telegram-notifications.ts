import type { PrismaClient } from "@prisma/client";
import { decrypt } from "../utils/crypto.js";
import { sendTelegramMessage } from "../utils/telegram.js";
import { createChildLogger } from "../utils/logger.js";
import {
  formatPipelineStartNotification,
  formatPipelineSuccessNotification,
  formatPipelineFailureNotification,
  type NotificationContext,
} from "./telegram-message-formatters.js";

const log = createChildLogger("telegram-notifications");

/**
 * Retrieves Telegram credentials for a company from the database
 */
async function getTelegramCredentials(
  db: PrismaClient,
  companyId: string
): Promise<{ botToken: string; chatId: string } | null> {
  try {
    const [botTokenSecret, chatIdSecret] = await Promise.all([
      db.companySecret.findUnique({
        where: {
          companyId_name: {
            companyId,
            name: "telegram_bot_token",
          },
        },
      }),
      db.companySecret.findUnique({
        where: {
          companyId_name: {
            companyId,
            name: "telegram_chat_id",
          },
        },
      }),
    ]);

    if (!botTokenSecret || !chatIdSecret) {
      // Credentials not configured - no-op
      return null;
    }

    try {
      const botToken = decrypt(botTokenSecret.value);
      const chatId = decrypt(chatIdSecret.value);
      return { botToken, chatId };
    } catch (error) {
      log.error(
        { companyId, error },
        "Failed to decrypt Telegram credentials"
      );
      return null;
    }
  } catch (error) {
    log.error({ companyId, error }, "Failed to retrieve Telegram credentials");
    return null;
  }
}

/**
 * Retrieves pipeline and issue context for detailed notifications
 */
async function getPipelineContext(
  db: PrismaClient,
  pipelineRunId: string
): Promise<NotificationContext> {
  const context: NotificationContext = {
    pipelineId: pipelineRunId,
  };

  try {
    const pipeline = await db.pipelineRun.findUnique({
      where: { id: pipelineRunId },
      include: {
        issue: {
          select: {
            title: true,
          },
        },
      },
    });

    if (pipeline) {
      context.issueTitle = pipeline.issue?.title || null;
      context.pipelineStage = pipeline.currentStepKey || null;

      // Calculate duration if pipeline has started and either completed or is in progress
      if (pipeline.startedAt) {
        const endTime = pipeline.completedAt || new Date();
        const durationMs = endTime.getTime() - pipeline.startedAt.getTime();
        context.durationSeconds = Math.round(durationMs / 1000);
      }
    }
  } catch (error) {
    log.warn(
      { pipelineRunId, error },
      "Failed to retrieve pipeline context for notification"
    );
    // Continue with what we have - we'll still send a notification
  }

  return context;
}

/**
 * Sends a Telegram notification for pipeline start event with rich formatting
 * Executes asynchronously without blocking pipeline execution
 */
export async function notifyPipelineStarted(
  db: PrismaClient,
  companyId: string,
  pipelineRunId: string,
  issueTitle?: string | null
): Promise<void> {
  // Fire and forget - don't await this
  Promise.resolve()
    .then(async () => {
      const creds = await getTelegramCredentials(db, companyId);
      if (!creds) {
        // Telegram not configured - no-op
        return;
      }

      const context = await getPipelineContext(db, pipelineRunId);
      // Use provided issueTitle if available (for backward compatibility)
      if (issueTitle && !context.issueTitle) {
        context.issueTitle = issueTitle;
      }

      const formatted = formatPipelineStartNotification(context);
      return sendTelegramMessage(
        creds.botToken,
        creds.chatId,
        formatted.message,
        formatted.parseMode
      );
    })
    .catch((error) => {
      log.error(
        { companyId, pipelineRunId, error },
        "Unexpected error in notifyPipelineStarted"
      );
    });
}

/**
 * Sends a Telegram notification for pipeline completion event with rich formatting
 * Executes asynchronously without blocking pipeline execution
 */
export async function notifyPipelineCompleted(
  db: PrismaClient,
  companyId: string,
  pipelineRunId: string,
  issueTitle?: string | null
): Promise<void> {
  // Fire and forget - don't await this
  Promise.resolve()
    .then(async () => {
      const creds = await getTelegramCredentials(db, companyId);
      if (!creds) {
        // Telegram not configured - no-op
        return;
      }

      const context = await getPipelineContext(db, pipelineRunId);
      // Use provided issueTitle if available (for backward compatibility)
      if (issueTitle && !context.issueTitle) {
        context.issueTitle = issueTitle;
      }

      const formatted = formatPipelineSuccessNotification(context);
      return sendTelegramMessage(
        creds.botToken,
        creds.chatId,
        formatted.message,
        formatted.parseMode
      );
    })
    .catch((error) => {
      log.error(
        { companyId, pipelineRunId, error },
        "Unexpected error in notifyPipelineCompleted"
      );
    });
}

/**
 * Sends a Telegram notification for pipeline failure event with rich formatting and error details
 * Executes asynchronously without blocking pipeline execution
 */
export async function notifyPipelineFailed(
  db: PrismaClient,
  companyId: string,
  pipelineRunId: string,
  issueTitle?: string | null,
  errorSummary?: string | null
): Promise<void> {
  // Fire and forget - don't await this
  Promise.resolve()
    .then(async () => {
      const creds = await getTelegramCredentials(db, companyId);
      if (!creds) {
        // Telegram not configured - no-op
        return;
      }

      const context = await getPipelineContext(db, pipelineRunId);
      // Use provided parameters if available (for backward compatibility)
      if (issueTitle && !context.issueTitle) {
        context.issueTitle = issueTitle;
      }
      if (errorSummary) {
        context.errorReason = errorSummary;
      }

      // Also check if there's an error stored in the pipeline
      if (!context.errorReason) {
        try {
          const pipeline = await db.pipelineRun.findUnique({
            where: { id: pipelineRunId },
            select: { lastError: true },
          });
          if (pipeline?.lastError) {
            context.errorReason = pipeline.lastError;
          }
        } catch (error) {
          log.warn(
            { pipelineRunId, error },
            "Failed to retrieve lastError from pipeline"
          );
        }
      }

      const formatted = formatPipelineFailureNotification(context);
      return sendTelegramMessage(
        creds.botToken,
        creds.chatId,
        formatted.message,
        formatted.parseMode
      );
    })
    .catch((error) => {
      log.error(
        { companyId, pipelineRunId, error },
        "Unexpected error in notifyPipelineFailed"
      );
    });
}
