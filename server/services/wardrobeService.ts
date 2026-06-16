/**
 * Searches a user's wardrobe for clothing items that semantically match a given text query.
 *
 * @param clientProfileId The ID of the user whose wardrobe to search.
 * @param queryText The natural language query (e.g., "something warm and cozy for a rainy day").
 * @param limit The maximum number of items to return. Defaults to 5.
 * @param minSimilarity The minimum similarity score (0 to 1) for an item to be included. Defaults to 0.5.
 * @returns A promise that resolves to an array of matching clothing items, sorted by relevance.
 */
import prismadb from '@/server/db';
import { generateQueryEmbedding } from './embedding';
import { ClothingMainCategory } from '@prisma/client'; // 导入 Prisma 的枚举类型

// 定义一个精确的返回类型，包含处理器需要的所有字段以及相似度分数
export type WardrobeSearchResult = {
  id: string;
  imageUrl: string;
  mainCategory: ClothingMainCategory;
  subCategory: string;
  description: string | null;
  colors: string[];
  similarity: number;
};

/**
 * 根据文本在用户的衣橱中进行语义搜索
 * @param searchText - 经过提炼的搜索关键词
 * @param userId - 用户的 ID (对应 clientProfileId)
 * @param limit - 返回结果的最大数量
 * @returns - 返回一个包含衣物信息和相似度分数的数组
 */
export async function searchWardrobeItemsByText(
  searchText: string,
  userId: string,
  limit: number = 5,
  mainCategory?: ClothingMainCategory
): Promise<WardrobeSearchResult[]> {
  console.log(`[RAG-SEARCH] Initiating search for userId: ${userId}`);
  console.log(
    `[RAG-SEARCH] Searching with keywords: "${searchText}"` +
      (mainCategory ? `, mainCategory: ${mainCategory}` : '')
  );

  if (!searchText.trim()) {
    console.log('[RAG-SEARCH] SearchText is empty, returning empty array.');
    return [];
  }

  try {
    const queryEmbedding = await generateQueryEmbedding(searchText);
    if (!queryEmbedding || queryEmbedding.length === 0) {
      console.error('[RAG-SEARCH] Failed to generate query embedding.');
      return [];
    }
    console.log(`[RAG-SEARCH] Generated query embedding (first 3 dims): ${queryEmbedding.slice(0, 3)}...`);

    // [FIX] Manually format the embedding array into a string that pgvector understands.
    const vectorQueryString = `[${queryEmbedding.join(',')}]`;

    // pgvector: <=> 是 cosine distance，similarity = 1 - cosine_distance
    const results: WardrobeSearchResult[] = mainCategory
      ? await prismadb.$queryRaw`
          SELECT
            "id",
            "imageUrl",
            "mainCategory",
            "subCategory",
            "description",
            "colors",
            1 - ("embedding" <=> ${vectorQueryString}::vector) as similarity
          FROM
            "ClothingItem"
          WHERE
            "clientProfileId" = ${userId}
            AND "embedding" IS NOT NULL
            AND "mainCategory" = ${mainCategory}::"ClothingMainCategory"
          ORDER BY
            "embedding" <=> ${vectorQueryString}::vector
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
            1 - ("embedding" <=> ${vectorQueryString}::vector) as similarity
          FROM
            "ClothingItem"
          WHERE
            "clientProfileId" = ${userId} AND "embedding" IS NOT NULL
          ORDER BY
            "embedding" <=> ${vectorQueryString}::vector
          LIMIT ${limit};
        `;

    console.log('[RAG-SEARCH] Raw search results from DB:', JSON.stringify(results, null, 2));

    if (!results || results.length === 0) {
      console.log('[RAG-SEARCH] No items found in the database for this user.');
      return [];
    }

    const SIMILARITY_THRESHOLD = 0.5;

    const filteredResults = results.filter(item => item.similarity > SIMILARITY_THRESHOLD);

    console.log(`[RAG-SEARCH] Found ${filteredResults.length} items after filtering by threshold (${SIMILARITY_THRESHOLD}).`);

    return filteredResults;
  } catch (error) {
    console.error('Error during wardrobe search:', error);
    return [];
  }
}

/**
 * Retrieves the details of a single clothing item from the database.
 * NOTE: This function provides the raw data access.
 * The caller (e.g., a Server Action) is responsible for ensuring the user has permission to access the item.
 * @param itemId The ID of the clothing item to retrieve.
 * @returns A promise that resolves to the clothing item's details or null if not found.
 */
export async function getWardrobeItemDetails(itemId: string) {
  try {
    const item = await prismadb.clothingItem.findUnique({
      where: {
        id: itemId,
      },
      select: {
        id: true,
        subCategory: true, // 使用 subCategory 作为显示名称
        imageUrl: true,
        clientProfileId: true, // 关键：为安全检查包含此字段
      },
    });
    return item;
  } catch (error) {
    console.error(`[DB-ERROR] Failed to fetch clothing item with id "${itemId}":`, error);
    return null;
  }
}

/**
 * 删除属于指定用户的衣橱单品（支持批量）。
 * 仅删除数据库记录；GCS 图片不做清理。
 */
export async function deleteWardrobeItems(
  itemIds: string[],
  clientId: string
): Promise<number> {
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

