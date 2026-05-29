CREATE EXTENSION IF NOT EXISTS vector;

-- AlterTable
ALTER TABLE "ClothingItem" ADD COLUMN     "embedding" vector(768);

