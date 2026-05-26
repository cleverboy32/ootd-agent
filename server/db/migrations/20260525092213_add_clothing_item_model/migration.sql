-- CreateEnum
CREATE TYPE "ClothingMainCategory" AS ENUM ('TOP', 'BOTTOM', 'OUTERWEAR', 'FOOTWEAR', 'ACCESSORY', 'ONE_PIECE');

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'completed',
ALTER COLUMN "content" SET DEFAULT '{}';

-- CreateTable
CREATE TABLE "ClothingItem" (
    "id" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "mainCategory" "ClothingMainCategory" NOT NULL,
    "subCategory" TEXT NOT NULL,
    "description" TEXT,
    "colors" TEXT[],
    "tags" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "clientProfileId" TEXT NOT NULL,

    CONSTRAINT "ClothingItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClothingItem_clientProfileId_idx" ON "ClothingItem"("clientProfileId");
