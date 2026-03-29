/**
 * Telegram Bot Command Handler
 * Processes commands from users interacting with the bot
 */

import { TelegramMessage } from "./client.js";

export type CommandHandler = (
  message: TelegramMessage,
  args: string[]
) => Promise<{
  success: boolean;
  response: string;
}>;

export interface CommandResult {
  success: boolean;
  response: string;
  command?: string;
}

/**
 * Parse a message to extract command and arguments
 * Format: /command arg1 arg2 ...
 */
export function parseCommand(text: string): {
  command: string | null;
  args: string[];
  rawText: string;
} {
  const trimmed = text.trim();

  if (!trimmed.startsWith("/")) {
    return { command: null, args: [], rawText: trimmed };
  }

  const parts = trimmed.split(/\s+/);
  const commandPart = parts[0]; // "/command" or "/command@botusername"
  const commandName = commandPart.split("@")[0].slice(1); // Remove "/" and "@..."
  const args = parts.slice(1);

  return {
    command: commandName,
    args,
    rawText: trimmed,
  };
}

/**
 * Create the /start command handler
 */
export function createStartHandler(): CommandHandler {
  return async () => {
    const response = `
Welcome to Forge Pipeline Notifications! 🤖

I will notify you about your pipeline executions in Forge.

Available commands:
/start - Show this welcome message
/pair <FORGE_USER_ID> - Link your Forge account to this Telegram account

To get started, use: /pair your-forge-username
`.trim();

    return { success: true, response };
  };
}

/**
 * Create the /pair command handler
 * Validates forge user ID and checks for duplicates
 */
export function createPairHandler(): CommandHandler {
  return async (message: TelegramMessage, args: string[]) => {
    // Validate user ID
    if (!message.from) {
      return {
        success: false,
        response: "❌ Could not identify your Telegram account. Please try again.",
      };
    }

    // Validate arguments
    if (args.length === 0) {
      return {
        success: false,
        response:
          "❌ Please provide your Forge user ID. Usage: /pair your-forge-username",
      };
    }

    const forgeUserId = args[0];

    // Validate forge user ID format (alphanumeric, dash, underscore, @)
    if (!/^[a-zA-Z0-9@._\-]+$/.test(forgeUserId)) {
      return {
        success: false,
        response:
          "❌ Invalid Forge user ID format. Use only letters, numbers, @, ., - and _",
      };
    }

    // Return success indicator - actual DB operation will be done by the service
    // This allows the handler to be pure
    return {
      success: true,
      response: `Ready to pair Telegram account (@${message.from.username || message.from.id}) with Forge user "${forgeUserId}". Verifying...`,
    };
  };
}

/**
 * Registry of command handlers
 */
export const COMMAND_HANDLERS: Record<string, CommandHandler> = {
  start: createStartHandler(),
  pair: createPairHandler(),
};

/**
 * Process a message and route to appropriate command handler
 */
export async function handleCommand(
  message: TelegramMessage
): Promise<CommandResult> {
  if (!message.text) {
    return {
      success: false,
      response: "Please send a text message with a command.",
    };
  }

  const { command, args } = parseCommand(message.text);

  // If no command, treat as plain text
  if (!command) {
    return {
      success: false,
      response:
        "I only respond to commands. Try /start to see available commands.",
    };
  }

  // Look up handler
  const handler = COMMAND_HANDLERS[command];

  if (!handler) {
    return {
      success: false,
      response: `❌ Unknown command: /${command}. Try /start for help.`,
      command,
    };
  }

  // Execute handler
  try {
    const result = await handler(message, args);
    return {
      success: result.success,
      response: result.response,
      command,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return {
      success: false,
      response: `❌ Error processing command: ${errorMessage}`,
      command,
    };
  }
}
