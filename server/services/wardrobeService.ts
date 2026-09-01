/**
 * Searches a user's wardrobe for clothing items that semantically match a given text query.
 */
import prismadb from '@/server/db';
import type { GatekeeperIntent } from '@/server/agents/intent';
import {
  buildWardrobeDocumentEmbeddingText,
  buildWardrobeQueryEmbeddingText,
  type WardrobeQueryEmbeddingContext,
} from '@/server/utils/embeddingText';
import {
  buildVisualEmbeddingDocumentText,
  clothingItemToEmbeddingFields,
} from '@/server/utils/wardrobeAnalysis';
import type { WardrobeSearchSlot } from '@/server/utils/ragSearchSlots';
import {
  generateTextEmbedding,
  generateVisualEmbedding,
  getTextSimilarityThresholds,
} from './embedding';
import { withRetryOn429 } from '@/server/utils/retryOn429';
import { ClothingMainCategory } from '@prisma/client';

export interface WardrobeSearchEmbeddingContext extends WardrobeQueryEmbeddingContext {
  /** 脚本对比用：跳过 query 文本格式化，使用原始 query 生成向量 */
  useRawQueryEmbedding?: boolean;
}

export interface WardrobeSearchOptions {
  slot?: WardrobeSearchSlot;
  intent?: GatekeeperIntent;
  embedding?: WardrobeSearchEmbeddingContext;
}

export type WardrobeSearchResult = {
  id: string;
  imageUrl: string;
  mainCategory: ClothingMainCategory;
  subCategory: string;
  description: string | null;
  colors: string[];
  season: string[];
  material: string[];
  tags: string[];
  similarity: number;
};

export async function searchWardrobeItemsByText(
  searchText: string,
  userId: string,
  limit: number = 5,
  mainCategory?: ClothingMainCategory,
  options?: WardrobeSearchOptions
): Promise<WardrobeSearchResult[]> {
  console.log(`[RAG-SEARCH] Initiating search for userId: ${userId}`);
  console.log(
    `[RAG-SEARCH] Searching with keywords: "${searchText}"` +
      (mainCategory ? `, mainCategory: ${mainCategory}` : '') +
      (options?.slot ? `, slot: ${options.slot}` : '')
  );

  if (!searchText.trim()) {
    console.log('[RAG-SEARCH] SearchText is empty, returning empty array.');
    return [];
  }

  try {
    const embeddingContext: WardrobeQueryEmbeddingContext = {
      slot: options?.slot ?? options?.embedding?.slot,
      intent: options?.intent ?? options?.embedding?.intent,
    };
    const textForEmbedding = options?.embedding?.useRawQueryEmbedding
      ? searchText.trim()
      : buildWardrobeQueryEmbeddingText(searchText, embeddingContext);

    console.log(`[RAG-SEARCH] Text embedding input: "${textForEmbedding}"`);

    const queryEmbedding = await generateTextEmbedding(textForEmbedding);
    if (!queryEmbedding || queryEmbedding.length === 0) {
      console.error('[RAG-SEARCH] Failed to generate query embedding.');
      return [];
    }

    const vectorQueryString = `[${queryEmbedding.join(',')}]`;

    const results: WardrobeSearchResult[] = mainCategory
      ? await prismadb.$queryRaw`
          SELECT
            "id",
            "imageUrl",
            "mainCategory",
            "subCategory",
            "description",
            "colors",
            "season",
            "material",
            "tags",
            1 - ("textEmbedding" <=> ${vectorQueryString}::vector) as similarity
          FROM
            "ClothingItem"
          WHERE
            "clientProfileId" = ${userId}
            AND "textEmbedding" IS NOT NULL
            AND "mainCategory" = ${mainCategory}::"ClothingMainCategory"
          ORDER BY
            "textEmbedding" <=> ${vectorQueryString}::vector
          LIMIT ${limit};
        `
      : await prismadb.$queryRaw`
          SELECT
            "id",
            "imageUrl",
            "mainCategory",
            "subCategory",
            "description",
            "colors",
            "season",
            "material",
            "tags",
            1 - ("textEmbedding" <=> ${vectorQueryString}::vector) as similarity
          FROM
            "ClothingItem"
          WHERE
            "clientProfileId" = ${userId} AND "textEmbedding" IS NOT NULL
          ORDER BY
            "textEmbedding" <=> ${vectorQueryString}::vector
          LIMIT ${limit};
        `;

    console.log('[RAG-SEARCH] Raw search results from DB:', JSON.stringify(results, null, 2));

    if (!results || results.length === 0) {
      console.log('[RAG-SEARCH] No items found in the database for this user.');
      return [];
    }

    const SIMILARITY_THRESHOLD = getTextSimilarityThresholds().search;
    const filteredResults = results.filter((item) => item.similarity > SIMILARITY_THRESHOLD);

    console.log(
      `[RAG-SEARCH] Found ${filteredResults.length} items after filtering by threshold (${SIMILARITY_THRESHOLD}).`
    );

    return filteredResults;
  } catch (error) {
    console.error('Error during wardrobe search:', error);
    return [];
  }
}

export async function getWardrobeItemDetails(itemId: string) {
  try {
    const item = await prismadb.clothingItem.findUnique({
      where: { id: itemId },
      select: {
        id: true,
        subCategory: true,
        imageUrl: true,
        clientProfileId: true,
      },
    });
    return item;
  } catch (error) {
    console.error(`[DB-ERROR] Failed to fetch clothing item with id "${itemId}":`, error);
    return null;
  }
}

export async function deleteWardrobeItems(itemIds: string[], clientId: string): Promise<number> {
  const uniqueIds = [...new Set(itemIds.map((id) => id.trim()).filter(Boolean))];
  if (uniqueIds.length === 0) return 0;

  const result = await prismadb.clothingItem.deleteMany({
    where: {
      id: { in: uniqueIds },
      clientProfileId: clientId,
    },
  });

  return result.count;
}

export async function findWardrobeItemByImageUrl(clientId: string, imageUrl: string) {
  return prismadb.clothingItem.findFirst({
    where: { clientProfileId: clientId, imageUrl },
    orderBy: { createdAt: 'desc' },
  });
}

export async function clothingItemHasTextEmbedding(itemId: string): Promise<boolean> {
  const rows = await prismadb.$queryRaw<{ has_text_embedding: boolean }[]>`
    SELECT ("textEmbedding" IS NOT NULL) AS has_text_embedding
    FROM "ClothingItem"
    WHERE id = ${itemId}
    LIMIT 1
  `;
  return rows[0]?.has_text_embedding === true;
}

export async function clothingItemHasVisualEmbedding(itemId: string): Promise<boolean> {
  const rows = await prismadb.$queryRaw<{ has_visual_embedding: boolean }[]>`
    SELECT (embedding IS NOT NULL) AS has_visual_embedding
    FROM "ClothingItem"
    WHERE id = ${itemId}
    LIMIT 1
  `;
  return rows[0]?.has_visual_embedding === true;
}

/** @deprecated 使用 clothingItemHasVisualEmbedding */
export async function clothingItemHasEmbedding(itemId: string): Promise<boolean> {
  return clothingItemHasVisualEmbedding(itemId);
}

export async function persistTextEmbedding(itemId: string): Promise<number> {
  const item = await prismadb.clothingItem.findUnique({ where: { id: itemId } });
  if (!item) {
    throw new Error(`Clothing item not found: ${itemId}`);
  }

  const textForEmbedding = buildWardrobeDocumentEmbeddingText(
    clothingItemToEmbeddingFields(item)
  );

  const startedAt = Date.now();
  const embeddingVector = await withRetryOn429(
    () => generateTextEmbedding(textForEmbedding),
    { label: 'Wardrobe text embedding', maxRetries: 4 }
  );

  const vectorString = `[${embeddingVector.join(',')}]`;
  await prismadb.$executeRaw`
    UPDATE "ClothingItem"
    SET "textEmbedding" = ${vectorString}::vector
    WHERE id = ${itemId};
  `;

  console.log('[TEXT_EMBED] Text embedding persisted', {
    itemId,
    dims: embeddingVector.length,
    ms: Date.now() - startedAt,
  });

  return embeddingVector.length;
}

export async function persistVisualEmbedding(itemId: string): Promise<number> {
  const item = await prismadb.clothingItem.findUnique({ where: { id: itemId } });
  if (!item) {
    throw new Error(`Clothing item not found: ${itemId}`);
  }

  const textForEmbedding = buildVisualEmbeddingDocumentText(item);

  const startedAt = Date.now();
  const embeddingVector = await withRetryOn429(
    () => generateVisualEmbedding(textForEmbedding, item.imageUrl),
    { label: 'Wardrobe visual embedding', maxRetries: 4 }
  );

  const vectorString = `[${embeddingVector.join(',')}]`;
  await prismadb.$executeRaw`
    UPDATE "ClothingItem"
    SET "embedding" = ${vectorString}::vector
    WHERE id = ${itemId};
  `;

  console.log('[VISUAL_EMBED] Visual embedding persisted', {
    itemId,
    dims: embeddingVector.length,
    ms: Date.now() - startedAt,
  });

  return embeddingVector.length;
}

/** @deprecated 使用 persistVisualEmbedding */
export async function persistWardrobeItemEmbedding(itemId: string): Promise<number> {
  return persistVisualEmbedding(itemId);
}
