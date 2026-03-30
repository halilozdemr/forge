/**
 * Telegram User Pairing Service
 * Handles the business logic for pairing Forge users with Telegram accounts
 */

import { PrismaClient } from "@prisma/client";

export interface PairingRequest {
  companyId: string;
  forgeUserId: string;
  telegramUserId: number;
  telegramUsername?: string;
}

export interface PairingResult {
  success: boolean;
  message: string;
  telegramUserId?: number;
  forgeUserId?: string;
}

/**
 * Pair a Forge user with a Telegram account
 * Validates that neither is already paired and creates the pairing
 */
export async function pairUser(
  db: PrismaClient,
  request: PairingRequest
): Promise<PairingResult> {
  const { companyId, forgeUserId, telegramUserId, telegramUsername } = request;

  // Validate inputs
  if (!companyId || !forgeUserId || !telegramUserId) {
    return {
      success: false,
      message:
        "❌ Invalid pairing request: missing required fields (companyId, forgeUserId, telegramUserId)",
    };
  }

  if (telegramUserId <= 0) {
    return {
      success: false,
      message: "❌ Invalid Telegram user ID",
    };
  }

  try {
    // Check if forge user is already paired
    const existingPairingByForge = await db.telegramUser.findUnique({
      where: {
        companyId_forgeUserId: {
          companyId,
          forgeUserId,
        },
      },
    });

    if (existingPairingByForge) {
      return {
        success: false,
        message: `❌ Forge user "${forgeUserId}" is already paired with a Telegram account`,
      };
    }

    // Check if telegram user is already paired
    const existingPairingByTelegram = await db.telegramUser.findUnique({
      where: {
        companyId_telegramUserId: {
          companyId,
          telegramUserId: BigInt(telegramUserId),
        },
      },
    });

    if (existingPairingByTelegram) {
      return {
        success: false,
        message: `❌ This Telegram account is already paired with Forge user "${existingPairingByTelegram.forgeUserId}"`,
      };
    }

    // Create the pairing
    const pairing = await db.telegramUser.create({
      data: {
        companyId,
        forgeUserId,
        telegramUserId: BigInt(telegramUserId),
        telegramUsername: telegramUsername || null,
      },
    });

    return {
      success: true,
      message: `✅ Successfully paired! Forge user "${forgeUserId}" is now linked to your Telegram account. You will receive pipeline notifications here.`,
      telegramUserId: Number(pairing.telegramUserId),
      forgeUserId: pairing.forgeUserId,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown database error";
    return {
      success: false,
      message: `❌ Pairing failed: ${errorMessage}`,
    };
  }
}

/**
 * Get a pairing by forge user ID
 */
export async function getPairingByForgeUser(
  db: PrismaClient,
  companyId: string,
  forgeUserId: string
) {
  try {
    return await db.telegramUser.findUnique({
      where: {
        companyId_forgeUserId: {
          companyId,
          forgeUserId,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching pairing:", error);
    return null;
  }
}

/**
 * Get a pairing by telegram user ID
 */
export async function getPairingByTelegramUser(
  db: PrismaClient,
  companyId: string,
  telegramUserId: number
) {
  try {
    return await db.telegramUser.findUnique({
      where: {
        companyId_telegramUserId: {
          companyId,
          telegramUserId: BigInt(telegramUserId),
        },
      },
    });
  } catch (error) {
    console.error("Error fetching pairing:", error);
    return null;
  }
}

/**
 * List all pairings for a company
 */
export async function listPairingsByCompany(
  db: PrismaClient,
  companyId: string
) {
  try {
    return await db.telegramUser.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
    });
  } catch (error) {
    console.error("Error listing pairings:", error);
    return [];
  }
}

/**
 * Remove a pairing
 */
export async function unpairUser(
  db: PrismaClient,
  companyId: string,
  forgeUserId: string
): Promise<boolean> {
  try {
    const result = await db.telegramUser.deleteMany({
      where: {
        companyId,
        forgeUserId,
      },
    });
    return result.count > 0;
  } catch (error) {
    console.error("Error removing pairing:", error);
    return false;
  }
}
