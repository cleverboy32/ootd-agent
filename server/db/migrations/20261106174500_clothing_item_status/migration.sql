-- 衣橱上传状态。已有单品视为分析完成。
CREATE TYPE "ClothingItemStatus" AS ENUM ('analyzing', 'completed', 'failed');

ALTER TABLE "ClothingItem"
ADD COLUMN "status" "ClothingItemStatus" NOT NULL DEFAULT 'completed';
