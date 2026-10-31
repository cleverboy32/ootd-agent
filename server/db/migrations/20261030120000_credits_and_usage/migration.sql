-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "creditBalance" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE IF NOT EXISTS "CreditLedger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "messageId" TEXT,
    "imageId" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CreditRedeemCode" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "maxUses" INTEGER NOT NULL DEFAULT 1,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditRedeemCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "UsageEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "clientId" TEXT,
    "conversationId" TEXT,
    "messageId" TEXT,
    "model" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "cacheHitTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheMissTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "embeddingTokens" INTEGER NOT NULL DEFAULT 0,
    "generatedImages" INTEGER NOT NULL DEFAULT 0,
    "costCny" DECIMAL(12,6),
    "rateId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "UsageMessageRollup" (
    "messageId" TEXT NOT NULL,
    "userId" TEXT,
    "conversationId" TEXT,
    "calls" INTEGER NOT NULL DEFAULT 0,
    "cacheHitTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheMissTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "embeddingTokens" INTEGER NOT NULL DEFAULT 0,
    "generatedImages" INTEGER NOT NULL DEFAULT 0,
    "pricedCostCny" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "unpricedCalls" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsageMessageRollup_pkey" PRIMARY KEY ("messageId")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CreditLedger_userId_createdAt_idx" ON "CreditLedger"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "CreditRedeemCode_codeHash_key" ON "CreditRedeemCode"("codeHash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "UsageEvent_messageId_createdAt_idx" ON "UsageEvent"("messageId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "UsageEvent_userId_createdAt_idx" ON "UsageEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "UsageEvent_createdAt_idx" ON "UsageEvent"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "UsageMessageRollup_userId_updatedAt_idx" ON "UsageMessageRollup"("userId", "updatedAt");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "CreditLedger" ADD CONSTRAINT "CreditLedger_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "UsageEvent" ADD CONSTRAINT "UsageEvent_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
