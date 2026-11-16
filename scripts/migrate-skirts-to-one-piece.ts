/**
 * 将 BOTTOM 中的裙装迁到 ONE_PIECE，并重写 text embedding。
 * 用法：pnpm exec dotenv -e .env -e .env.local -- tsx scripts/migrate-skirts-to-one-piece.ts
 */
import prismadb from '../server/db';
import { isBottomRowSkirtCandidate } from '../server/utils/wardrobeAnalysis';
import { persistTextEmbedding } from '../server/services/wardrobeService';

async function main() {
  const db = prismadb;
  const bottoms = await db.clothingItem.findMany({
    where: { mainCategory: 'BOTTOM' },
    select: {
      id: true,
      subCategory: true,
      description: true,
      userId: true,
    },
  });

  const skirts = bottoms.filter((item) =>
    isBottomRowSkirtCandidate(item.subCategory || '', item.description || '')
  );

  console.log(`BOTTOM total=${bottoms.length}, skirt candidates=${skirts.length}`);
  if (skirts.length === 0) {
    await db.$disconnect();
    return;
  }

  for (const item of skirts) {
    await db.clothingItem.update({
      where: { id: item.id },
      data: { mainCategory: 'ONE_PIECE' },
    });
    const dims = await persistTextEmbedding(item.id);
    console.log('migrated', {
      id: item.id,
      subCategory: item.subCategory,
      userId: item.userId,
      dims,
    });
  }

  await db.$disconnect();
  console.log(`done: migrated ${skirts.length} items`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
