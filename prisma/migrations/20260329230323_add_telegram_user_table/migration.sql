-- CreateTable: telegram_users
-- Stores mappings between Forge users and Telegram accounts
-- Enables sending pipeline notifications to Telegram users
CREATE TABLE "telegram_users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "forgeUserId" TEXT NOT NULL,
    "telegramUserId" INTEGER NOT NULL,
    "telegramUsername" TEXT,
    "pairedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "telegram_users_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateUniqueIndex: one pairing per forge user per company
CREATE UNIQUE INDEX "telegram_users_companyId_forgeUserId_key" ON "telegram_users"("companyId", "forgeUserId");

-- CreateUniqueIndex: one pairing per telegram user per company
CREATE UNIQUE INDEX "telegram_users_companyId_telegramUserId_key" ON "telegram_users"("companyId", "telegramUserId");

-- CreateIndex: efficient lookups by company and creation time for listing/auditing
CREATE INDEX "telegram_users_companyId_createdAt_idx" ON "telegram_users"("companyId", "createdAt");
