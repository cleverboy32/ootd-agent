-- 同一用户、同一张图只保留一条衣橱记录。连点上传时后一次插入会被拒绝。
CREATE UNIQUE INDEX "ClothingItem_userId_imageUrl_key" ON "ClothingItem"("userId", "imageUrl");
