-- AlterTable
ALTER TABLE "SavedOutfit" ADD COLUMN "sourceConversationId" TEXT;

-- Backfill from Message when possible
UPDATE "SavedOutfit" AS s
SET "sourceConversationId" = m."conversationId"
FROM "Message" AS m
WHERE s."sourceMessageId" = m."id"
  AND s."sourceConversationId" IS NULL;
