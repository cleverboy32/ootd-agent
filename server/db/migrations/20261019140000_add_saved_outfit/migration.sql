-- CreateTable
CREATE TABLE "SavedOutfit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceMessageId" TEXT,
    "sourceOutfitId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "coverImageUrl" TEXT,
    "snapshot" JSONB NOT NULL,
    "eligibleForPlan" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedOutfit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SavedOutfit_userId_createdAt_idx" ON "SavedOutfit"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SavedOutfit_userId_sourceMessageId_sourceOutfitId_key" ON "SavedOutfit"("userId", "sourceMessageId", "sourceOutfitId");

-- AddForeignKey
ALTER TABLE "SavedOutfit" ADD CONSTRAINT "SavedOutfit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
