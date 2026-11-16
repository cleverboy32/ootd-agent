/**
 * 厚下装与常规下装在 12℃ 切开：存量 (4,15)/(5,15) → (4,11)/(5,11)。
 * 用法：pnpm exec dotenv -e .env -e .env.local -- tsx scripts/patch-thick-bottom-temp-cut.ts
 */
import prismadb from '../server/db';

async function main() {
  const db = prismadb;

  const skirts = await db.clothingItem.updateMany({
    where: {
      mainCategory: 'ONE_PIECE',
      tempMin: 4,
      tempMax: 15,
    },
    data: { tempMax: 11 },
  });

  const pants = await db.clothingItem.updateMany({
    where: {
      mainCategory: 'BOTTOM',
      tempMin: 5,
      tempMax: 15,
    },
    data: { tempMax: 11 },
  });

  console.log('patched', {
    onePiece_4_15_to_4_11: skirts.count,
    bottom_5_15_to_5_11: pants.count,
  });

  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
