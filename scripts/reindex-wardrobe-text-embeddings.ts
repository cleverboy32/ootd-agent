import { parseArgs } from 'node:util';
import prismadb from '@/server/db';
import { persistTextEmbedding } from '@/server/services/wardrobeService';

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { 'user-id': { type: 'string' } } });
  const userId = values['user-id']?.trim();
  if (values['user-id'] !== undefined && !userId) throw new Error('--user-id needs a user ID');
  const items = await prismadb.clothingItem.findMany({
    where: userId ? { userId, status: 'completed' } : undefined,
    select: { id: true, subCategory: true },
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
