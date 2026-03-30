import { describe, it, expect } from "vitest";
import { parseCommand, handleCommand, createStartHandler, createPairHandler } from "./command-handler.js";
import type { TelegramMessage } from "./client.js";

describe("parseCommand", () => {
  it("should parse simple command", () => {
    const result = parseCommand("/start");
    expect(result.command).toBe("start");
    expect(result.args).toEqual([]);
  });

  it("should parse command with arguments", () => {
    const result = parseCommand("/pair user@example.com");
    expect(result.command).toBe("pair");
    expect(result.args).toEqual(["user@example.com"]);
  });

  it("should parse command with multiple arguments", () => {
    const result = parseCommand("/pair john.doe --force");
    expect(result.command).toBe("pair");
    expect(result.args).toEqual(["john.doe", "--force"]);
  });

  it("should handle command with bot username", () => {
    const result = parseCommand("/start@forge_bot");
    expect(result.command).toBe("start");
    expect(result.args).toEqual([]);
  });

  it("should handle whitespace", () => {
    const result = parseCommand("  /pair   user123  ");
    expect(result.command).toBe("pair");
    expect(result.args).toEqual(["user123"]);
  });

  it("should return null for non-command text", () => {
    const result = parseCommand("Hello world");
    expect(result.command).toBeNull();
    expect(result.args).toEqual([]);
    expect(result.rawText).toBe("Hello world");
  });

  it("should handle empty string", () => {
    const result = parseCommand("");
    expect(result.command).toBeNull();
    expect(result.args).toEqual([]);
  });
});

describe("createStartHandler", () => {
  it("should return welcome message", async () => {
    const handler = createStartHandler();
    const message: TelegramMessage = {
      message_id: 1,
      chat: { id: 123, type: "private" },
      date: 1234567890,
      from: { id: 123, is_bot: false, first_name: "User" },
    };

    const result = await handler(message, []);
    expect(result.success).toBe(true);
    expect(result.response).toContain("Welcome");
    expect(result.response).toContain("/pair");
  });
});

describe("createPairHandler", () => {
  it("should handle pair command with valid arguments", async () => {
    const handler = createPairHandler();
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
    };

    const result = await handler(message, ["john.doe"]);
    expect(result.success).toBe(true);
    expect(result.response).toContain("Ready to pair");
    expect(result.response).toContain("john.doe");
  });

  it("should reject pair without arguments", async () => {
    const handler = createPairHandler();
    const message: TelegramMessage = {
      message_id: 1,
      chat: { id: 123, type: "private" },
      date: 1234567890,
      from: {
        id: 123456,
        is_bot: false,
        first_name: "John",
      },
    };

    const result = await handler(message, []);
    expect(result.success).toBe(false);
    expect(result.response).toContain("Please provide your Forge user ID");
  });

  it("should reject invalid forge user ID format", async () => {
    const handler = createPairHandler();
    const message: TelegramMessage = {
      message_id: 1,
      chat: { id: 123, type: "private" },
      date: 1234567890,
      from: {
        id: 123456,
        is_bot: false,
        first_name: "John",
      },
    };

    const result = await handler(message, ["user!!!invalid"]);
    expect(result.success).toBe(false);
    expect(result.response).toContain("Invalid Forge user ID format");
  });

  it("should accept valid forge user ID formats", async () => {
    const handler = createPairHandler();
    const validIds = ["user123", "john.doe", "user@example.com", "john_doe", "john-doe"];

    const message: TelegramMessage = {
      message_id: 1,
      chat: { id: 123, type: "private" },
      date: 1234567890,
      from: { id: 123456, is_bot: false, first_name: "John" },
    };

    for (const id of validIds) {
      const result = await handler(message, [id]);
      expect(result.success, `Should accept ${id}`).toBe(true);
    }
  });

  it("should handle message without from field", async () => {
    const handler = createPairHandler();
    const message: TelegramMessage = {
      message_id: 1,
      chat: { id: 123, type: "private" },
      date: 1234567890,
    };

    const result = await handler(message, ["user123"]);
    expect(result.success).toBe(false);
    expect(result.response).toContain("Could not identify");
  });
});

describe("handleCommand", () => {
  it("should handle /start command", async () => {
    const message: TelegramMessage = {
      message_id: 1,
      chat: { id: 123, type: "private" },
      date: 1234567890,
      from: { id: 123, is_bot: false, first_name: "User" },
      text: "/start",
    };

    const result = await handleCommand(message);
    expect(result.success).toBe(true);
    expect(result.response).toContain("Welcome");
    expect(result.command).toBe("start");
  });

  it("should handle /pair command", async () => {
    const message: TelegramMessage = {
      message_id: 1,
      chat: { id: 123, type: "private" },
      date: 1234567890,
      from: { id: 123456, is_bot: false, first_name: "User" },
      text: "/pair john.doe",
    };

    const result = await handleCommand(message);
    expect(result.success).toBe(true);
    expect(result.command).toBe("pair");
  });

  it("should handle unknown command", async () => {
    const message: TelegramMessage = {
      message_id: 1,
      chat: { id: 123, type: "private" },
      date: 1234567890,
      from: { id: 123, is_bot: false, first_name: "User" },
      text: "/unknown",
    };

    const result = await handleCommand(message);
    expect(result.success).toBe(false);
    expect(result.response).toContain("Unknown command");
  });

  it("should handle plain text message", async () => {
    const message: TelegramMessage = {
      message_id: 1,
      chat: { id: 123, type: "private" },
      date: 1234567890,
      from: { id: 123, is_bot: false, first_name: "User" },
      text: "Hello bot",
    };

    const result = await handleCommand(message);
    expect(result.success).toBe(false);
    expect(result.response).toContain("only respond to commands");
  });

  it("should handle message without text", async () => {
    const message: TelegramMessage = {
      message_id: 1,
      chat: { id: 123, type: "private" },
      date: 1234567890,
      from: { id: 123, is_bot: false, first_name: "User" },
    };

    const result = await handleCommand(message);
    expect(result.success).toBe(false);
    expect(result.response).toContain("text message");
  });

  it("should handle handler errors gracefully", async () => {
    const message: TelegramMessage = {
      message_id: 1,
      chat: { id: 123, type: "private" },
      date: 1234567890,
      from: { id: 123, is_bot: false, first_name: "User" },
      text: "/start",
    };

    const result = await handleCommand(message);
    // Should not throw, should return error in response
    expect(result).toBeDefined();
  });
});
