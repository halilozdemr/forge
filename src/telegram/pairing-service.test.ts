import { describe, it, expect, vi, beforeEach } from "vitest";
import { pairUser, getPairingByForgeUser, getPairingByTelegramUser, listPairingsByCompany, unpairUser } from "./pairing-service.js";
import type { PrismaClient } from "@prisma/client";

describe("pairUser", () => {
  let mockDb: any;

  beforeEach(() => {
    mockDb = {
      telegramUser: {
        findUnique: vi.fn(),
        create: vi.fn(),
        deleteMany: vi.fn(),
        findMany: vi.fn(),
      },
    } as unknown as PrismaClient;
  });

  it("should pair user successfully", async () => {
    mockDb.telegramUser.findUnique.mockResolvedValue(null);
    mockDb.telegramUser.create.mockResolvedValue({
      id: "pair-1",
      companyId: "comp-1",
      forgeUserId: "john.doe",
      telegramUserId: 123456,
      telegramUsername: "johndoe",
      pairedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await pairUser(mockDb, {
      companyId: "comp-1",
      forgeUserId: "john.doe",
      telegramUserId: 123456,
      telegramUsername: "johndoe",
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain("Successfully paired");
    expect(result.forgeUserId).toBe("john.doe");
  });

  it("should reject pairing if forge user already paired", async () => {
    mockDb.telegramUser.findUnique
      .mockResolvedValueOnce({
        id: "pair-1",
        companyId: "comp-1",
        forgeUserId: "john.doe",
        telegramUserId: 111111,
      })
      .mockResolvedValueOnce(null);

    const result = await pairUser(mockDb, {
      companyId: "comp-1",
      forgeUserId: "john.doe",
      telegramUserId: 123456,
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("already paired");
  });

  it("should reject pairing if telegram user already paired", async () => {
    mockDb.telegramUser.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "pair-2",
        companyId: "comp-1",
        forgeUserId: "jane.doe",
        telegramUserId: 123456,
      });

    const result = await pairUser(mockDb, {
      companyId: "comp-1",
      forgeUserId: "john.doe",
      telegramUserId: 123456,
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("already paired with Forge user");
  });

  it("should validate telegram user ID", async () => {
    const result = await pairUser(mockDb, {
      companyId: "comp-1",
      forgeUserId: "john.doe",
      telegramUserId: -1,
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("Invalid Telegram user ID");
  });

  it("should validate required fields", async () => {
    const result = await pairUser(mockDb, {
      companyId: "",
      forgeUserId: "john.doe",
      telegramUserId: 123456,
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("Invalid pairing request");
  });

  it("should handle database errors", async () => {
    mockDb.telegramUser.findUnique.mockRejectedValue(
      new Error("Database connection failed")
    );

    const result = await pairUser(mockDb, {
      companyId: "comp-1",
      forgeUserId: "john.doe",
      telegramUserId: 123456,
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("Pairing failed");
  });
});

describe("getPairingByForgeUser", () => {
  let mockDb: any;

  beforeEach(() => {
    mockDb = {
      telegramUser: {
        findUnique: vi.fn(),
      },
    } as unknown as PrismaClient;
  });

  it("should find pairing by forge user", async () => {
    const pairing = {
      id: "pair-1",
      companyId: "comp-1",
      forgeUserId: "john.doe",
      telegramUserId: 123456,
      telegramUsername: "johndoe",
    };
    mockDb.telegramUser.findUnique.mockResolvedValue(pairing);

    const result = await getPairingByForgeUser(mockDb, "comp-1", "john.doe");

    expect(result).toEqual(pairing);
    expect(mockDb.telegramUser.findUnique).toHaveBeenCalled();
  });

  it("should return null if pairing not found", async () => {
    mockDb.telegramUser.findUnique.mockResolvedValue(null);

    const result = await getPairingByForgeUser(mockDb, "comp-1", "john.doe");

    expect(result).toBeNull();
  });

  it("should handle errors gracefully", async () => {
    mockDb.telegramUser.findUnique.mockRejectedValue(
      new Error("Database error")
    );

    const result = await getPairingByForgeUser(mockDb, "comp-1", "john.doe");

    expect(result).toBeNull();
  });
});

describe("getPairingByTelegramUser", () => {
  let mockDb: any;

  beforeEach(() => {
    mockDb = {
      telegramUser: {
        findUnique: vi.fn(),
      },
    } as unknown as PrismaClient;
  });

  it("should find pairing by telegram user", async () => {
    const pairing = {
      id: "pair-1",
      companyId: "comp-1",
      forgeUserId: "john.doe",
      telegramUserId: 123456,
    };
    mockDb.telegramUser.findUnique.mockResolvedValue(pairing);

    const result = await getPairingByTelegramUser(mockDb, "comp-1", 123456);

    expect(result).toEqual(pairing);
  });

  it("should return null if pairing not found", async () => {
    mockDb.telegramUser.findUnique.mockResolvedValue(null);

    const result = await getPairingByTelegramUser(mockDb, "comp-1", 123456);

    expect(result).toBeNull();
  });
});

describe("listPairingsByCompany", () => {
  let mockDb: any;

  beforeEach(() => {
    mockDb = {
      telegramUser: {
        findMany: vi.fn(),
      },
    } as unknown as PrismaClient;
  });

  it("should list all pairings for company", async () => {
    const pairings = [
      {
        id: "pair-1",
        companyId: "comp-1",
        forgeUserId: "john.doe",
        telegramUserId: 123456,
      },
      {
        id: "pair-2",
        companyId: "comp-1",
        forgeUserId: "jane.doe",
        telegramUserId: 654321,
      },
    ];
    mockDb.telegramUser.findMany.mockResolvedValue(pairings);

    const result = await listPairingsByCompany(mockDb, "comp-1");

    expect(result).toEqual(pairings);
    expect(mockDb.telegramUser.findMany).toHaveBeenCalledWith({
      where: { companyId: "comp-1" },
      orderBy: { createdAt: "desc" },
    });
  });

  it("should return empty array if no pairings", async () => {
    mockDb.telegramUser.findMany.mockResolvedValue([]);

    const result = await listPairingsByCompany(mockDb, "comp-1");

    expect(result).toEqual([]);
  });

  it("should handle errors gracefully", async () => {
    mockDb.telegramUser.findMany.mockRejectedValue(
      new Error("Database error")
    );

    const result = await listPairingsByCompany(mockDb, "comp-1");

    expect(result).toEqual([]);
  });
});

describe("unpairUser", () => {
  let mockDb: any;

  beforeEach(() => {
    mockDb = {
      telegramUser: {
        deleteMany: vi.fn(),
      },
    } as unknown as PrismaClient;
  });

  it("should unpair user successfully", async () => {
    mockDb.telegramUser.deleteMany.mockResolvedValue({ count: 1 });

    const result = await unpairUser(mockDb, "comp-1", "john.doe");

    expect(result).toBe(true);
  });

  it("should return false if no pairing found", async () => {
    mockDb.telegramUser.deleteMany.mockResolvedValue({ count: 0 });

    const result = await unpairUser(mockDb, "comp-1", "john.doe");

    expect(result).toBe(false);
  });

  it("should handle errors gracefully", async () => {
    mockDb.telegramUser.deleteMany.mockRejectedValue(
      new Error("Database error")
    );

    const result = await unpairUser(mockDb, "comp-1", "john.doe");

    expect(result).toBe(false);
  });
});
