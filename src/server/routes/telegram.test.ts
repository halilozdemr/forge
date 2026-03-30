import { describe, it, expect, beforeEach, vi } from "vitest";
import { validateBotTokenFormat, validateChatIdFormat, testTelegramConnection } from "../../utils/telegram.js";

describe("Telegram utilities", () => {
  describe("validateBotTokenFormat", () => {
    it("accepts valid bot token format", () => {
      expect(validateBotTokenFormat("123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11")).toBe(
        true
      );
    });

    it("accepts bot token with underscores", () => {
      expect(validateBotTokenFormat("123456:ABC_DEF_1234_ghIkl")).toBe(true);
    });

    it("accepts bot token with numbers only in numeric part", () => {
      expect(validateBotTokenFormat("999999:abcdef1234567890abc")).toBe(true);
    });

    it("rejects token without colon", () => {
      expect(validateBotTokenFormat("123456ABC-DEF1234ghIkl-zyx57W2v1u123ew11")).toBe(
        false
      );
    });

    it("rejects token with too few numeric digits", () => {
      expect(validateBotTokenFormat("123:ABC-DEF1234ghIkl")).toBe(false);
    });

    it("rejects token with alphanumeric part too short", () => {
      expect(validateBotTokenFormat("123456:abc")).toBe(false);
    });

    it("rejects empty string", () => {
      expect(validateBotTokenFormat("")).toBe(false);
    });
  });

  describe("validateChatIdFormat", () => {
    it("accepts positive numeric chat ID", () => {
      expect(validateChatIdFormat("123456789")).toBe(true);
    });

    it("accepts negative numeric chat ID for groups", () => {
      expect(validateChatIdFormat("-123456789")).toBe(true);
    });

    it("accepts single digit chat ID", () => {
      expect(validateChatIdFormat("1")).toBe(true);
    });

    it("accepts large chat ID", () => {
      expect(validateChatIdFormat("1234567890123456")).toBe(true);
    });

    it("rejects non-numeric chat ID", () => {
      expect(validateChatIdFormat("abc123")).toBe(false);
    });

    it("rejects chat ID with spaces", () => {
      expect(validateChatIdFormat("123 456")).toBe(false);
    });

    it("rejects empty string", () => {
      expect(validateChatIdFormat("")).toBe(false);
    });

    it("rejects chat ID with special characters", () => {
      expect(validateChatIdFormat("123@456")).toBe(false);
    });
  });

  describe("testTelegramConnection", () => {
    it("rejects invalid token format before making API call", async () => {
      const result = await testTelegramConnection(
        "invalid-token",
        "123456"
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("Invalid bot token format");
    });

    it("rejects invalid chat ID format before making API call", async () => {
      const result = await testTelegramConnection(
        "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
        "not-numeric"
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("Invalid chat ID format");
    });

    it("handles network errors gracefully", async () => {
      // Mock fetch to throw an error
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockImplementation(() => {
        throw new Error("Network timeout");
      });

      try {
        const result = await testTelegramConnection(
          "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
          "123456"
        );

        expect(result.success).toBe(false);
        expect(result.message).toContain("Connection test failed");
        expect(result.details).toContain("Network timeout");
      } finally {
        global.fetch = originalFetch;
      }
    });
  });
});
