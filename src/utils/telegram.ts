/**
 * Telegram Bot API utility functions
 */

const TELEGRAM_API_BASE = "https://api.telegram.org";

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

/**
 * Validates Telegram bot token format
 * Format: digits:alphanumeric string
 */
export function validateBotTokenFormat(token: string): boolean {
  // Telegram bot tokens are in format: 123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
  // The numeric part should be at least 5 digits, alphanumeric part at least 15 chars
  const tokenPattern = /^\d{5,}:[a-zA-Z0-9_-]{15,}$/;
  return tokenPattern.test(token.trim());
}

/**
 * Validates Telegram chat ID format
 * Can be a positive number (user/channel) or negative number (group/supergroup)
 */
export function validateChatIdFormat(chatId: string): boolean {
  // Chat IDs are numeric, can be negative for groups
  const chatIdPattern = /^-?\d+$/;
  return chatIdPattern.test(chatId.trim());
}

/**
 * Tests connection to Telegram Bot API
 * Makes a simple getMe API call to verify credentials
 */
export async function testTelegramConnection(
  botToken: string,
  chatId: string
): Promise<{ success: boolean; message: string; details?: string }> {
  try {
    // Validate format first
    if (!validateBotTokenFormat(botToken)) {
      return {
        success: false,
        message: "Invalid bot token format",
        details: "Bot token should be in format: digits:alphanumeric (e.g., 123456:ABC-DEF...)",
      };
    }

    if (!validateChatIdFormat(chatId)) {
      return {
        success: false,
        message: "Invalid chat ID format",
        details: "Chat ID should be numeric (positive for users/channels, negative for groups)",
      };
    }

    // Test 1: Verify bot token with getMe
    const getMeUrl = `${TELEGRAM_API_BASE}/bot${botToken}/getMe`;
    const getMeResponse = await fetch(getMeUrl);

    if (!getMeResponse.ok) {
      return {
        success: false,
        message: "Failed to authenticate with Telegram Bot API",
        details: `HTTP ${getMeResponse.status}: ${getMeResponse.statusText}`,
      };
    }

    const getMeData = await getMeResponse.json() as { ok?: boolean; result?: { id?: number; username?: string } };
    if (!getMeData.ok) {
      return {
        success: false,
        message: "Invalid Telegram bot token",
        details: "The bot token does not correspond to a valid Telegram bot",
      };
    }

    // Test 2: Try to send a test message to verify chat ID accessibility
    const testMessageUrl = `${TELEGRAM_API_BASE}/bot${botToken}/sendMessage`;
    const testResponse = await fetch(testMessageUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: "Forge Telegram notification test - Configuration successful! ✅",
      }),
    });

    if (!testResponse.ok) {
      // Even if message send fails, we know the bot is valid
      // Chat ID might be invalid or bot doesn't have permissions
      const errorData = await testResponse.json() as { description?: string };
      return {
        success: false,
        message: "Failed to send test message to chat ID",
        details: errorData.description || `HTTP ${testResponse.status}`,
      };
    }

    const sendData = await testResponse.json() as { ok?: boolean };
    if (!sendData.ok) {
      return {
        success: false,
        message: "Failed to send test message",
        details: "The bot was authenticated but the message could not be sent to the chat ID",
      };
    }

    return {
      success: true,
      message: "Telegram connection successful",
      details: `Bot verified: ${getMeData.result?.username || "Unknown"} (ID: ${getMeData.result?.id})`,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    return {
      success: false,
      message: "Connection test failed",
      details: errorMessage,
    };
  }
}

/**
 * Sends a Telegram message to the configured chat
 * Returns true if message was sent successfully, false if it failed
 * Does not throw errors - failures are logged but don't block execution
 */
export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string
): Promise<boolean> {
  try {
    if (!botToken || !chatId) {
      // Credentials not configured - silently skip
      return false;
    }

    const sendUrl = `${TELEGRAM_API_BASE}/bot${botToken}/sendMessage`;
    const response = await fetch(sendUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
      }),
    });

    if (!response.ok) {
      // Log error but don't throw
      const errorData = (await response.json()) as { description?: string };
      console.error(
        `Failed to send Telegram message: HTTP ${response.status} - ${
          errorData.description || "Unknown error"
        }`
      );
      return false;
    }

    const sendData = (await response.json()) as { ok?: boolean };
    return sendData.ok === true;
  } catch (error) {
    // Log error but don't throw - Telegram failures should not block pipeline
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    console.error(`Telegram send error: ${errorMessage}`);
    return false;
  }
}
