-- AlterTable
ALTER TABLE "ClothingItem" ADD COLUMN     "material" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "season" TEXT[] DEFAULT ARRAY[]::TEXT[];
