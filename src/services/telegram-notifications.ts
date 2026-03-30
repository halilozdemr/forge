import type { PrismaClient } from "@prisma/client";
import { decrypt } from "../utils/crypto.js";
import { sendTelegramMessage } from "../utils/telegram.js";
import { createChildLogger } from "../utils/logger.js";

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
 * Sends a Telegram notification for pipeline start event
 * Executes asynchronously without blocking pipeline execution
 */
export async function notifyPipelineStarted(
  db: PrismaClient,
  companyId: string,
  pipelineRunId: string,
  issueTitle?: string | null
): Promise<void> {
  // Fire and forget - don't await this
  getTelegramCredentials(db, companyId)
    .then((creds) => {
      if (!creds) {
        // Telegram not configured - no-op
        return;
      }

      const message =
        issueTitle
          ? `🚀 Pipeline started: ${issueTitle}\n\nPipeline ID: ${pipelineRunId}`
          : `🚀 Pipeline started\n\nPipeline ID: ${pipelineRunId}`;

      return sendTelegramMessage(creds.botToken, creds.chatId, message);
    })
    .catch((error) => {
      log.error(
        { companyId, pipelineRunId, error },
        "Unexpected error in notifyPipelineStarted"
      );
    });
}

/**
 * Sends a Telegram notification for pipeline completion event
 * Executes asynchronously without blocking pipeline execution
 */
export async function notifyPipelineCompleted(
  db: PrismaClient,
  companyId: string,
  pipelineRunId: string,
  issueTitle?: string | null
): Promise<void> {
  // Fire and forget - don't await this
  getTelegramCredentials(db, companyId)
    .then((creds) => {
      if (!creds) {
        // Telegram not configured - no-op
        return;
      }

      const message =
        issueTitle
          ? `✅ Pipeline completed: ${issueTitle}\n\nPipeline ID: ${pipelineRunId}`
          : `✅ Pipeline completed\n\nPipeline ID: ${pipelineRunId}`;

      return sendTelegramMessage(creds.botToken, creds.chatId, message);
    })
    .catch((error) => {
      log.error(
        { companyId, pipelineRunId, error },
        "Unexpected error in notifyPipelineCompleted"
      );
    });
}

/**
 * Sends a Telegram notification for pipeline failure event
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
  getTelegramCredentials(db, companyId)
    .then((creds) => {
      if (!creds) {
        // Telegram not configured - no-op
        return;
      }

      let message: string;
      if (issueTitle) {
        message = `❌ Pipeline failed: ${issueTitle}\n\nPipeline ID: ${pipelineRunId}`;
        if (errorSummary) {
          // Truncate error summary to avoid extremely long messages
          const truncatedError =
            errorSummary.length > 200
              ? `${errorSummary.substring(0, 200)}...`
              : errorSummary;
          message += `\n\nError: ${truncatedError}`;
        }
      } else {
        message = `❌ Pipeline failed\n\nPipeline ID: ${pipelineRunId}`;
        if (errorSummary) {
          const truncatedError =
            errorSummary.length > 200
              ? `${errorSummary.substring(0, 200)}...`
              : errorSummary;
          message += `\n\nError: ${truncatedError}`;
        }
      }

      return sendTelegramMessage(creds.botToken, creds.chatId, message);
    })
    .catch((error) => {
      log.error(
        { companyId, pipelineRunId, error },
        "Unexpected error in notifyPipelineFailed"
      );
    });
}
