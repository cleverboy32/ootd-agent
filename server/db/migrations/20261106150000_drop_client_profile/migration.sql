-- 档案 / 会话 / 衣橱改挂 User。有数据但没有对应用户的档案直接失败，不丢数据。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ClientProfile" cp
    LEFT JOIN "User" u ON u."clientProfileId" = cp.id
    WHERE u.id IS NULL
      AND (
        EXISTS (SELECT 1 FROM "Conversation" c WHERE c."clientId" = cp.id)
        OR EXISTS (SELECT 1 FROM "ClothingItem" i WHERE i."clientProfileId" = cp.id)
        OR cp."profileData"::text NOT IN ('{}', 'null')
      )
  ) THEN
    RAISE EXCEPTION 'ClientProfile has data but no User';
  END IF;
END $$;

ALTER TABLE "User" ADD COLUMN "profileData" JSONB NOT NULL DEFAULT '{}';

UPDATE "User" u
SET "profileData" = cp."profileData"
FROM "ClientProfile" cp
WHERE u."clientProfileId" = cp.id;

ALTER TABLE "Conversation" ADD COLUMN "userId" TEXT;

UPDATE "Conversation" c
SET "userId" = u.id
FROM "User" u
WHERE u."clientProfileId" = c."clientId";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Conversation" WHERE "userId" IS NULL) THEN
    RAISE EXCEPTION 'Conversation.clientId did not match a User';
  END IF;
END $$;

ALTER TABLE "Conversation" ALTER COLUMN "userId" SET NOT NULL;
DROP INDEX "Conversation_clientId_idx";
ALTER TABLE "Conversation" DROP COLUMN "clientId";
CREATE INDEX "Conversation_userId_idx" ON "Conversation"("userId");

ALTER TABLE "ClothingItem" ADD COLUMN "userId" TEXT;

UPDATE "ClothingItem" i
SET "userId" = u.id
FROM "User" u
WHERE u."clientProfileId" = i."clientProfileId";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "ClothingItem" WHERE "userId" IS NULL) THEN
    RAISE EXCEPTION 'ClothingItem.clientProfileId did not match a User';
  END IF;
END $$;

ALTER TABLE "ClothingItem" ALTER COLUMN "userId" SET NOT NULL;
DROP INDEX "ClothingItem_clientProfileId_idx";
ALTER TABLE "ClothingItem" DROP COLUMN "clientProfileId";
CREATE INDEX "ClothingItem_userId_idx" ON "ClothingItem"("userId");

DROP INDEX "User_clientProfileId_key";
ALTER TABLE "User" DROP COLUMN "clientProfileId";
DROP TABLE "ClientProfile";
