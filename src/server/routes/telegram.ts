import type { FastifyInstance } from "fastify";
import { getDb } from "../../db/client.js";
import { encrypt, decrypt } from "../../utils/crypto.js";
import { testTelegramConnection } from "../../utils/telegram.js";

export async function telegramRoutes(server: FastifyInstance) {
  const db = getDb();

  // POST /v1/telegram/config - Save Telegram configuration
  server.post<{
    Body: {
      companyId: string;
      botToken: string;
      chatId: string;
    };
  }>("/telegram/config", async (request, reply) => {
    const { companyId, botToken, chatId } = request.body;

    if (!companyId || !botToken || !chatId) {
      return reply.code(400).send({
        error: "companyId, botToken, and chatId are required",
      });
    }

    try {
      const encryptedBotToken = encrypt(botToken);
      const encryptedChatId = encrypt(chatId);

      // Store both bot token and chat ID as separate secrets
      await Promise.all([
        db.companySecret.upsert({
          where: {
            companyId_name: { companyId, name: "telegram_bot_token" },
          },
          update: {
            value: encryptedBotToken,
          },
          create: {
            companyId,
            name: "telegram_bot_token",
            value: encryptedBotToken,
            description: "Telegram Bot API token (created via BotFather)",
          },
        }),
        db.companySecret.upsert({
          where: {
            companyId_name: { companyId, name: "telegram_chat_id" },
          },
          update: {
            value: encryptedChatId,
          },
          create: {
            companyId,
            name: "telegram_chat_id",
            value: encryptedChatId,
            description:
              "Telegram chat ID where notifications will be sent (numeric, can be negative for groups)",
          },
        }),
      ]);

      await db.activityLog.create({
        data: {
          companyId,
          actor: "user",
          action: "telegram.config.save",
          resource: "telegram:config",
          metadata: JSON.stringify({ botTokenLength: botToken.length }),
        },
      });

      return {
        success: true,
        message: "Telegram configuration saved successfully",
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      return reply.code(500).send({
        error: "Failed to save Telegram configuration",
        details: errorMessage,
      });
    }
  });

  // GET /v1/telegram/config - Retrieve Telegram configuration (without sensitive data)
  server.get<{ Querystring: { companyId: string } }>(
    "/telegram/config",
    async (request, reply) => {
      const { companyId } = request.query;

      if (!companyId) {
        return reply.code(400).send({ error: "companyId required" });
      }

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
          return {
            configured: false,
            message: "Telegram configuration not found",
          };
        }

        // Don't return the actual token/chat ID, just indicate it's configured
        return {
          configured: true,
          botTokenConfigured: !!botTokenSecret,
          chatIdConfigured: !!chatIdSecret,
          updatedAt: botTokenSecret.updatedAt,
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        return reply.code(500).send({
          error: "Failed to retrieve Telegram configuration",
          details: errorMessage,
        });
      }
    }
  );

  // POST /v1/telegram/test - Test Telegram connectivity
  server.post<{
    Body: {
      companyId: string;
      botToken: string;
      chatId: string;
    };
  }>("/telegram/test", async (request, reply) => {
    const { companyId, botToken, chatId } = request.body;

    if (!companyId || !botToken || !chatId) {
      return reply.code(400).send({
        error: "companyId, botToken, and chatId are required",
      });
    }

    try {
      const result = await testTelegramConnection(botToken, chatId);

      if (!result.success) {
        return reply.code(400).send({
          error: result.message,
          details: result.details,
        });
      }

      await db.activityLog.create({
        data: {
          companyId,
          actor: "user",
          action: "telegram.config.test",
          resource: "telegram:test",
          metadata: JSON.stringify({ success: true }),
        },
      });

      return {
        success: true,
        message: result.message,
        details: result.details,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      return reply.code(500).send({
        error: "Test failed",
        details: errorMessage,
      });
    }
  });
}
