/**
 * Telegram Bot Client
 * Manages Telegram Bot API communication and message handling
 */

export interface TelegramMessage {
  message_id: number;
  from?: {
    id: number;
    is_bot: boolean;
    first_name: string;
    username?: string;
  };
  chat: {
    id: number;
    type: string;
    title?: string;
  };
  date: number;
  text?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

export interface TelegramBotMe {
  ok: boolean;
  result?: TelegramUser;
}

export class TelegramClient {
  private token: string;
  private baseUrl: string;

  constructor(token: string) {
    if (!token || token.trim() === "") {
      throw new Error("Telegram bot token is required");
    }
    this.token = token;
    this.baseUrl = `https://api.telegram.org/bot${token}`;
  }

  /**
   * Test the bot connection by calling getMe
   */
  async testConnection(): Promise<TelegramUser> {
    const response = await fetch(`${this.baseUrl}/getMe`);
    const data = (await response.json()) as TelegramBotMe;

    if (!data.ok) {
      throw new Error("Failed to initialize Telegram bot: invalid token");
    }

    if (!data.result) {
      throw new Error("No bot data returned from Telegram API");
    }

    return data.result;
  }

  /**
   * Send a message to a Telegram user
   */
  async sendMessage(
    chatId: number | string,
    text: string
  ): Promise<TelegramMessage> {
    const url = `${this.baseUrl}/sendMessage`;
    const params = new URLSearchParams({
      chat_id: String(chatId),
      text,
    });

    const response = await fetch(`${url}?${params}`);
    const data = await response.json() as any;

    if (!data.ok) {
      throw new Error(
        `Failed to send message: ${data.description || "Unknown error"}`
      );
    }

    return data.result as TelegramMessage;
  }

  /**
   * Set up the webhook for receiving updates (future implementation)
   */
  async setWebhook(webhookUrl: string): Promise<boolean> {
    const url = `${this.baseUrl}/setWebhook`;
    const params = new URLSearchParams({
      url: webhookUrl,
    });

    const response = await fetch(`${url}?${params}`, { method: "POST" });
    const data = await response.json() as any;

    return data.ok === true;
  }

  /**
   * Get updates using polling (for testing)
   */
  async getUpdates(offset: number = 0): Promise<TelegramUpdate[]> {
    const url = `${this.baseUrl}/getUpdates`;
    const params = new URLSearchParams({
      offset: String(offset),
      timeout: "30",
    });

    const response = await fetch(`${url}?${params}`);
    const data = await response.json() as any;

    if (!data.ok) {
      throw new Error(`Failed to get updates: ${data.description || "Unknown error"}`);
    }

    return data.result as TelegramUpdate[];
  }
}
