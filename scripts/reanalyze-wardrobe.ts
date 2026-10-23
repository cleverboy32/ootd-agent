import prismadb from '@/server/db';
import { reanalyzeWardrobeItem } from '@/server/services/analyzeWardrobeItem';

function readArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found?.slice(prefix.length);
}

async function main(): Promise<void> {
  if (process.argv.includes('--list')) {
    const items = await prismadb.clothingItem.findMany({
      select: { id: true, subCategory: true, description: true, colors: true },
      orderBy: { createdAt: 'asc' },
    });
    for (const item of items) {
      console.log(
        [item.id, item.subCategory, item.colors.join('/'), (item.description ?? '').slice(0, 90)].join(' | ')
      );
    }
    return;
  }

  const ids = readArg('ids')
    ?.split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  const limit = Number(readArg('limit') ?? (ids?.length ? ids.length : 0));
  const items = await prismadb.clothingItem.findMany({
    where: ids?.length ? { id: { in: ids } } : undefined,
    orderBy: { createdAt: 'asc' },
    take: Number.isFinite(limit) && limit > 0 ? limit : undefined,
  });

  console.log(`[WARDROBE_REANALYZE] ${items.length} items`);
  for (const [index, item] of items.entries()) {
    console.log(
      `[WARDROBE_REANALYZE] before ${index + 1}/${items.length} ${item.id} ${item.subCategory} | ${item.description}`
    );
    try {
      const updated = await reanalyzeWardrobeItem(item.id);
      console.log(
        `[WARDROBE_REANALYZE] after ${item.id} ${updated.subCategory} | ${updated.description} | colors=${updated.colors.join(',')} | material=${updated.material.join(',')} | temp=${updated.tempMin ?? ''}-${updated.tempMax ?? ''} | search=${updated.searchDescription}`
      );
    } catch (error) {
      console.error(`[WARDROBE_REANALYZE] failed ${item.id}`, error);
    }
  }
}

main()
  .then(async () => {
    await prismadb.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error('[WARDROBE_REANALYZE] Failed:', error);
    await prismadb.$disconnect();
    process.exitCode = 1;
  });
