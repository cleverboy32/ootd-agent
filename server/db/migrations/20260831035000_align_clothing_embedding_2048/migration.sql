-- Existing vectors have a different dimensionality and cannot be cast safely.
-- They are derived data and must be regenerated after this migration.
UPDATE "ClothingItem" SET "embedding" = NULL WHERE "embedding" IS NOT NULL;

ALTER TABLE "ClothingItem"
  ALTER COLUMN "embedding" TYPE vector(2048);
