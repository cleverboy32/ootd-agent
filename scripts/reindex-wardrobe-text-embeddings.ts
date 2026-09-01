import prismadb from '@/server/db';
import { persistTextEmbedding } from '@/server/services/wardrobeService';

async function main(): Promise<void> {
  const items = await prismadb.clothingItem.findMany({
    orderBy: { createdAt: 'asc' },
  });

  console.log(`[TEXT_EMBED_REINDEX] Reindexing text embeddings for ${items.length} items...`);

  for (const [index, item] of items.entries()) {
    await persistTextEmbedding(item.id);
    console.log(
      `[TEXT_EMBED_REINDEX] ${index + 1}/${items.length} ${item.id} (${item.subCategory})`
    );
  }
}

main()
  .then(async () => {
    await prismadb.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error('[TEXT_EMBED_REINDEX] Failed:', error);
    await prismadb.$disconnect();
    process.exitCode = 1;
  });
