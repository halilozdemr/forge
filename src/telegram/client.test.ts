import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TelegramClient } from "./client.js";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

describe("TelegramClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("initialization", () => {
    it("should throw error when token is empty", () => {
      expect(() => new TelegramClient("")).toThrow("Telegram bot token is required");
    });

    it("should throw error when token is whitespace", () => {
      expect(() => new TelegramClient("   ")).toThrow("Telegram bot token is required");
    });

    it("should create client with valid token", () => {
      const client = new TelegramClient("123456:ABC-DEF");
      expect(client).toBeDefined();
    });
  });

  describe("testConnection", () => {
    it("should successfully test connection with valid token", async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => ({
          ok: true,
          result: {
            id: 123456,
            is_bot: true,
            first_name: "TestBot",
            username: "test_bot",
          },
        }),
      });

      const client = new TelegramClient("123456:ABC-DEF");
      const result = await client.testConnection();

      expect(result).toEqual({
        id: 123456,
        is_bot: true,
        first_name: "TestBot",
        username: "test_bot",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.telegram.org/bot123456:ABC-DEF/getMe"
      );
    });

    it("should throw error when ok is false", async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => ({
          ok: false,
          description: "Unauthorized",
        }),
      });

      const client = new TelegramClient("invalid-token");
      await expect(client.testConnection()).rejects.toThrow(
        "Failed to initialize Telegram bot: invalid token"
      );
    });

    it("should throw error when no result returned", async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => ({
          ok: true,
          result: null,
        }),
      });

      const client = new TelegramClient("123456:ABC-DEF");
      await expect(client.testConnection()).rejects.toThrow(
        "No bot data returned from Telegram API"
      );
    });
  });

  describe("sendMessage", () => {
    it("should successfully send message", async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => ({
          ok: true,
          result: {
            message_id: 42,
            from: {
              id: 123456,
              is_bot: true,
              first_name: "TestBot",
            },
            chat: {
              id: 987654,
              type: "private",
            },
            date: 1234567890,
            text: "Hello!",
          },
        }),
      });

      const client = new TelegramClient("123456:ABC-DEF");
      const result = await client.sendMessage(987654, "Hello!");

      expect(result).toBeDefined();
      expect(result.text).toBe("Hello!");
      expect(mockFetch).toHaveBeenCalled();
    });

    it("should throw error when message send fails", async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => ({
          ok: false,
          description: "Chat not found",
        }),
      });

      const client = new TelegramClient("123456:ABC-DEF");
      await expect(client.sendMessage(99999, "Test")).rejects.toThrow(
        "Failed to send message: Chat not found"
      );
    });

    it("should handle string and number chat IDs", async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => ({
          ok: true,
          result: { message_id: 42 },
        }),
      });

      const client = new TelegramClient("123456:ABC-DEF");
      await client.sendMessage("987654", "Test");

      // Verify the URL contains the chat ID
      const callUrl = mockFetch.mock.calls[0][0];
      expect(callUrl).toContain("chat_id=987654");
    });
  });

  describe("getUpdates", () => {
    it("should successfully get updates", async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => ({
          ok: true,
          result: [
            {
              update_id: 1,
              message: {
                message_id: 1,
                from: { id: 123, is_bot: false, first_name: "User" },
                chat: { id: 123, type: "private" },
                date: 1234567890,
                text: "/start",
              },
            },
          ],
        }),
      });

      const client = new TelegramClient("123456:ABC-DEF");
      const result = await client.getUpdates(0);

      expect(result).toHaveLength(1);
      expect(result[0].update_id).toBe(1);
      expect(result[0].message?.text).toBe("/start");
    });

    it("should handle empty updates", async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => ({
          ok: true,
          result: [],
        }),
      });

      const client = new TelegramClient("123456:ABC-DEF");
      const result = await client.getUpdates(0);

      expect(result).toHaveLength(0);
    });

    it("should throw error when getUpdates fails", async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => ({
          ok: false,
          description: "Bad Request",
        }),
      });

      const client = new TelegramClient("123456:ABC-DEF");
      await expect(client.getUpdates(0)).rejects.toThrow(
        "Failed to get updates"
      );
    });
  });
});
