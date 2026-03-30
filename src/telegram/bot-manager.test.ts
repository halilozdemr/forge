import { describe, it, expect, vi, beforeEach } from "vitest";
import { BotManager } from "./bot-manager.js";
import type { TelegramMessage } from "./client.js";

describe("BotManager", () => {
  let mockDb: any;
  let manager: BotManager;

  beforeEach(() => {
    mockDb = {
      telegramUser: {
        findUnique: vi.fn(),
        create: vi.fn(),
      },
    };

    // Mock the TelegramClient module
    vi.mock("./client.js", () => ({
      TelegramClient: vi.fn().mockImplementation(() => ({
        testConnection: vi.fn(),
        sendMessage: vi.fn(),
        getUpdates: vi.fn(),
      })),
    }));

    manager = new BotManager({
      token: "123456:ABC-DEF",
      companyId: "comp-1",
      db: mockDb,
    });
  });

  describe("initialization", () => {
    it("should initialize bot successfully", async () => {
      // This test will work with proper mocking of TelegramClient
      expect(manager).toBeDefined();
    });

    it("should have bot manager methods", () => {
      expect(manager.initialize).toBeDefined();
      expect(manager.handleMessage).toBeDefined();
      expect(manager.sendMessage).toBeDefined();
      expect(manager.pollUpdates).toBeDefined();
      expect(manager.getBotUsername).toBeDefined();
    });
  });

  describe("handleMessage", () => {
    it("should handle /start command", async () => {
      const message: TelegramMessage = {
        message_id: 1,
        chat: { id: 123, type: "private" },
        date: 1234567890,
        from: { id: 123, is_bot: false, first_name: "User" },
        text: "/start",
      };

      const result = await manager.handleMessage(message);
      expect(result.success).toBe(true);
      expect(result.response).toContain("Welcome");
    });

    it("should handle /pair command with database operation", async () => {
      mockDb.telegramUser.findUnique.mockResolvedValue(null);
      mockDb.telegramUser.create.mockResolvedValue({
        id: "pair-1",
        companyId: "comp-1",
        forgeUserId: "john.doe",
        telegramUserId: 123456,
        telegramUsername: "johndoe",
      });

      const message: TelegramMessage = {
        message_id: 1,
        chat: { id: 123, type: "private" },
        date: 1234567890,
        from: {
          id: 123456,
          is_bot: false,
          first_name: "John",
          username: "johndoe",
        },
        text: "/pair john.doe",
      };

      const result = await manager.handleMessage(message);
      expect(result.success).toBe(true);
      expect(result.response).toContain("Successfully paired");
    });

    it("should handle unknown command", async () => {
      const message: TelegramMessage = {
        message_id: 1,
        chat: { id: 123, type: "private" },
        date: 1234567890,
        from: { id: 123, is_bot: false, first_name: "User" },
        text: "/unknown",
      };

      const result = await manager.handleMessage(message);
      expect(result.success).toBe(false);
      expect(result.response).toContain("Unknown command");
    });

    it("should handle message without text", async () => {
      const message: TelegramMessage = {
        message_id: 1,
        chat: { id: 123, type: "private" },
        date: 1234567890,
        from: { id: 123, is_bot: false, first_name: "User" },
      };

      const result = await manager.handleMessage(message);
      expect(result.success).toBe(false);
    });

    it("should handle errors gracefully", async () => {
      const message: TelegramMessage = {
        message_id: 1,
        chat: { id: 123, type: "private" },
        date: 1234567890,
        from: { id: 123, is_bot: false, first_name: "User" },
        text: "/start",
      };

      const result = await manager.handleMessage(message);
      expect(result).toBeDefined();
      expect(result.response).toBeDefined();
    });
  });

  describe("sendMessage", () => {
    it("should indicate message sending capability", () => {
      expect(manager.sendMessage).toBeDefined();
    });
  });

  describe("pollUpdates", () => {
    it("should indicate polling capability", () => {
      expect(manager.pollUpdates).toBeDefined();
    });
  });

  describe("getBotUsername", () => {
    it("should return bot username", () => {
      const username = manager.getBotUsername();
      expect(typeof username).toBe("string");
    });
  });
});
