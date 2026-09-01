-- Dual embedding: text RAG + preserved visual (multimodal) vectors.
ALTER TABLE "ClothingItem" ADD COLUMN "searchDescription" TEXT;
ALTER TABLE "ClothingItem" ADD COLUMN "occasions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "ClothingItem" ADD COLUMN "formality" TEXT;
ALTER TABLE "ClothingItem" ADD COLUMN "silhouette" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "ClothingItem" ADD COLUMN "textEmbedding" vector(2048);
