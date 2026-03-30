/**
 * Telegram Module
 * Exports all Telegram-related functionality
 */

export { TelegramClient, type TelegramMessage, type TelegramUpdate, type TelegramUser, type TelegramBotMe } from "./client.js";
export { BotManager, type BotManagerConfig } from "./bot-manager.js";
export { handleCommand, parseCommand, createStartHandler, createPairHandler, type CommandHandler, type CommandResult, COMMAND_HANDLERS } from "./command-handler.js";
export {
  pairUser,
  getPairingByForgeUser,
  getPairingByTelegramUser,
  listPairingsByCompany,
  unpairUser,
  type PairingRequest,
  type PairingResult,
} from "./pairing-service.js";
