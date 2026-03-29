/**
 * Telegram Bot Manager
 * High-level orchestration of bot initialization, message handling, and pairing
 */

import { PrismaClient } from "@prisma/client";
import { TelegramClient } from "./client.js";
import { handleCommand } from "./command-handler.js";
import { pairUser } from "./pairing-service.js";
import { TelegramMessage } from "./client.js";

export interface BotManagerConfig {
  token: string;
  companyId: string;
  db: PrismaClient;
}

export class BotManager {
  private client: TelegramClient;
  private companyId: string;
  private db: PrismaClient;
  private botUsername: string = "";
  private lastUpdateId: number = 0;

  constructor(config: BotManagerConfig) {
    this.client = new TelegramClient(config.token);
    this.companyId = config.companyId;
    this.db = config.db;
  }

  /**
   * Initialize the bot and verify connection
   */
  async initialize(): Promise<{ success: boolean; username: string; message: string }> {
    try {
      const botInfo = await this.client.testConnection();
      this.botUsername = botInfo.username || "";
      return {
        success: true,
        username: botInfo.username || "",
        message: `✅ Telegram bot initialized: @${this.botUsername || "unknown"}`,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        username: "",
        message: `❌ Failed to initialize Telegram bot: ${errorMessage}`,
      };
    }
  }

  /**
   * Process an incoming message
   */
  async handleMessage(
    message: TelegramMessage
  ): Promise<{ success: boolean; response: string }> {
    try {
      // Handle command
      const commandResult = await handleCommand(message);

      if (!commandResult.success) {
        return {
          success: false,
          response: commandResult.response,
        };
      }

      // If it's a pair command, process the pairing
      if (commandResult.command === "pair") {
        const text = message.text || "";
        const args = text.split(/\s+/).slice(1); // Skip /pair
        const forgeUserId = args[0];

        if (message.from && forgeUserId) {
          const pairingResult = await pairUser(this.db, {
            companyId: this.companyId,
            forgeUserId,
            telegramUserId: message.from.id,
            telegramUsername: message.from.username,
          });

          return {
            success: pairingResult.success,
            response: pairingResult.message,
          };
        }
      }

      return {
        success: true,
        response: commandResult.response,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        response: `❌ Error processing message: ${errorMessage}`,
      };
    }
  }

  /**
   * Send a message to a user
   */
  async sendMessage(
    chatId: number | string,
    text: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      await this.client.sendMessage(chatId, text);
      return {
        success: true,
        message: "Message sent successfully",
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        message: `Failed to send message: ${errorMessage}`,
      };
    }
  }

  /**
   * Poll for updates (for testing purposes)
   */
  async pollUpdates(): Promise<{
    success: boolean;
    messagesProcessed: number;
    errors: string[];
  }> {
    try {
      const updates = await this.client.getUpdates(this.lastUpdateId);
      const errors: string[] = [];
      let processedCount = 0;

      for (const update of updates) {
        try {
          if (update.message) {
            const result = await this.handleMessage(update.message);
            if (result.success) {
              // Send response back to user
              await this.sendMessage(update.message.chat.id, result.response);
              processedCount++;
            } else {
              errors.push(`Message ${update.update_id}: ${result.response}`);
            }
          }
          this.lastUpdateId = update.update_id + 1;
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : "Unknown error";
          errors.push(`Update ${update.update_id}: ${errorMsg}`);
        }
      }

      return {
        success: errors.length === 0,
        messagesProcessed: processedCount,
        errors,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        messagesProcessed: 0,
        errors: [errorMessage],
      };
    }
  }

  /**
   * Get the bot username
   */
  getBotUsername(): string {
    return this.botUsername;
  }
}
