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
import { ClothingMainCategory, type ClothingItem, type ClothingItemStatus, type Prisma } from '@prisma/client';

export interface WardrobeSearchEmbeddingContext extends WardrobeQueryEmbeddingContext {
  /** 脚本对比用：跳过 query 文本格式化，使用原始 query 生成向量 */
  useRawQueryEmbedding?: boolean;
}

export interface WardrobeSearchOptions {
  slot?: WardrobeSearchSlot;
  intent?: GatekeeperIntent;
  embedding?: WardrobeSearchEmbeddingContext;
  /**
   * 当天气温（摄氏度）。有值时在向量检索 SQL 中按 tempMin/tempMax 前置过滤，
   * 避免不合温单品占满 top-K；两边界都空的旧单品仍保留。
   */
  temperatureCelsius?: number | null;
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
  /** 合适穿着温度下限。两个字段都空表示旧单品，检索时不过滤 */
  tempMin?: number | null;
  tempMax?: number | null;
};

export async function searchWardrobeItemsByText(
  searchText: string,
  userId: string,
  limit: number = 5,
  mainCategory?: ClothingMainCategory,
  options?: WardrobeSearchOptions
): Promise<WardrobeSearchResult[]> {
  const temperatureCelsius =
    options?.temperatureCelsius != null && Number.isFinite(options.temperatureCelsius)
      ? options.temperatureCelsius
      : null;

  console.log(`[RAG-SEARCH] Initiating search for userId: ${userId}`);
  console.log(
    `[RAG-SEARCH] Searching with keywords: "${searchText}"` +
      (mainCategory ? `, mainCategory: ${mainCategory}` : '') +
      (options?.slot ? `, slot: ${options.slot}` : '') +
      (temperatureCelsius !== null ? `, temperaturePrefilter: ${temperatureCelsius}℃` : '')
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

    // 温度前置：与 itemFitsTemperature 一致——边界空则不过滤该侧；双空旧单品保留。
    const results: WardrobeSearchResult[] =
      mainCategory && temperatureCelsius !== null
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
              "tempMin",
              "tempMax",
              1 - ("textEmbedding" <=> ${vectorQueryString}::vector) as similarity
            FROM
              "ClothingItem"
            WHERE
              "userId" = ${userId}
              AND "status" = 'completed'
              AND "textEmbedding" IS NOT NULL
              AND "mainCategory" = ${mainCategory}::"ClothingMainCategory"
              AND ("tempMin" IS NULL OR "tempMin" <= ${temperatureCelsius})
              AND ("tempMax" IS NULL OR "tempMax" >= ${temperatureCelsius})
            ORDER BY
              "textEmbedding" <=> ${vectorQueryString}::vector
            LIMIT ${limit};
          `
        : mainCategory
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
                "tempMin",
                "tempMax",
                1 - ("textEmbedding" <=> ${vectorQueryString}::vector) as similarity
              FROM
                "ClothingItem"
              WHERE
                "userId" = ${userId}
                AND "status" = 'completed'
              AND "textEmbedding" IS NOT NULL
                AND "mainCategory" = ${mainCategory}::"ClothingMainCategory"
              ORDER BY
                "textEmbedding" <=> ${vectorQueryString}::vector
              LIMIT ${limit};
            `
          : temperatureCelsius !== null
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
                  "tempMin",
                  "tempMax",
                  1 - ("textEmbedding" <=> ${vectorQueryString}::vector) as similarity
                FROM
                  "ClothingItem"
                WHERE
                  "userId" = ${userId}
                  AND "status" = 'completed'
              AND "textEmbedding" IS NOT NULL
                  AND ("tempMin" IS NULL OR "tempMin" <= ${temperatureCelsius})
                  AND ("tempMax" IS NULL OR "tempMax" >= ${temperatureCelsius})
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
                  "tempMin",
                  "tempMax",
                  1 - ("textEmbedding" <=> ${vectorQueryString}::vector) as similarity
                FROM
                  "ClothingItem"
                WHERE
                  "userId" = ${userId}
                  AND "status" = 'completed'
                  AND "textEmbedding" IS NOT NULL
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
        userId: true,
      },
    });
    return item;
  } catch (error) {
    console.error(`[DB-ERROR] Failed to fetch clothing item with id "${itemId}":`, error);
    return null;
  }
}

export async function deleteWardrobeItems(itemIds: string[], userId: string): Promise<number> {
  const uniqueIds = [...new Set(itemIds.map((id) => id.trim()).filter(Boolean))];
  if (uniqueIds.length === 0) return 0;

  const result = await prismadb.clothingItem.deleteMany({
    where: {
      id: { in: uniqueIds },
      userId: userId,
    },
  });

  return result.count;
}

export async function findWardrobeItemByImageUrl(userId: string, imageUrl: string) {
  return prismadb.clothingItem.findFirst({
    where: { userId: userId, imageUrl },
    orderBy: { createdAt: 'desc' },
  });
}

const ANALYZING_STALE_MS = 2 * 60 * 1000;

export type WardrobeUploadClaim =
  | { action: 'completed'; item: ClothingItem }
  | { action: 'wait'; item: ClothingItem }
  | { action: 'analyze'; item: ClothingItem };

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}

function isFreshAnalyzing(item: ClothingItem): boolean {
  return item.status === 'analyzing' && Date.now() - item.updatedAt.getTime() < ANALYZING_STALE_MS;
}

/** 同一张图只占一行。completed 直接复用；failed 或卡住的 analyzing 由本次请求接手。 */
export async function claimWardrobeUpload(userId: string, imageUrl: string): Promise<WardrobeUploadClaim> {
  let item = await findWardrobeItemByImageUrl(userId, imageUrl);
  if (!item) {
    try {
      item = await prismadb.clothingItem.create({
        data: {
          userId,
          imageUrl,
          mainCategory: 'TOP',
          subCategory: 'pending',
          colors: [],
          tags: [],
          status: 'analyzing',
        },
      });
      return { action: 'analyze', item };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      item = await findWardrobeItemByImageUrl(userId, imageUrl);
      if (!item) throw error;
    }
  }

  if (item.status === 'completed') return { action: 'completed', item };
  if (isFreshAnalyzing(item)) return { action: 'wait', item };

  const claimed = await prismadb.$executeRaw`
    UPDATE "ClothingItem"
    SET "status" = 'analyzing'::"ClothingItemStatus", "updatedAt" = NOW()
    WHERE "id" = ${item.id}
      AND (
        "status" = 'failed'::"ClothingItemStatus"
        OR (
          "status" = 'analyzing'::"ClothingItemStatus"
          AND "updatedAt" < NOW() - INTERVAL '2 minutes'
        )
      )
  `;
  if (Number(claimed) !== 1) {
    const latest = await findWardrobeItemByImageUrl(userId, imageUrl);
    if (latest?.status === 'completed') return { action: 'completed', item: latest };
    return { action: 'wait', item: latest ?? item };
  }

  const owned = await prismadb.clothingItem.findUnique({ where: { id: item.id } });
  return { action: 'analyze', item: owned ?? item };
}

export async function completeWardrobeAnalysis(
  itemId: string,
  data: Prisma.ClothingItemUpdateInput
): Promise<ClothingItem> {
  return prismadb.clothingItem.update({
    where: { id: itemId },
    data: { ...data, status: 'completed' },
  });
}

export async function failWardrobeAnalysis(itemId: string): Promise<void> {
  await prismadb.clothingItem.updateMany({
    where: { id: itemId, status: 'analyzing' },
    data: { status: 'failed' },
  });
}

export class WardrobeAnalysisInProgressError extends Error {
  readonly code = 'ANALYZING';

  constructor() {
    super('这件衣物正在分析，请稍后重试');
  }
}

export type WardrobeItemAnalysisClaim = {
  item: ClothingItem;
  previousStatus: ClothingItemStatus;
};

/** 重新分析已有单品。新鲜的 analyzing 不接手，避免同一次点击打两次模型。 */
export async function claimWardrobeItemAnalysis(itemId: string): Promise<WardrobeItemAnalysisClaim> {
  const item = await prismadb.clothingItem.findUnique({ where: { id: itemId } });
  if (!item) {
    throw new Error('Item not found');
  }
  if (isFreshAnalyzing(item)) {
    throw new WardrobeAnalysisInProgressError();
  }

  const claimed = await prismadb.$executeRaw`
    UPDATE "ClothingItem"
    SET "status" = 'analyzing'::"ClothingItemStatus", "updatedAt" = NOW()
    WHERE "id" = ${item.id}
      AND (
        "status" = 'completed'::"ClothingItemStatus"
        OR "status" = 'failed'::"ClothingItemStatus"
        OR (
          "status" = 'analyzing'::"ClothingItemStatus"
          AND "updatedAt" < NOW() - INTERVAL '2 minutes'
        )
      )
  `;
  if (Number(claimed) !== 1) {
    throw new WardrobeAnalysisInProgressError();
  }

  const owned = await prismadb.clothingItem.findUnique({ where: { id: item.id } });
  return { item: owned ?? item, previousStatus: item.status };
}

/** 重新分析失败时，已完成的单品恢复 completed，避免从列表消失。 */
export async function releaseWardrobeItemAnalysis(
  itemId: string,
  previousStatus: ClothingItemStatus
): Promise<void> {
  await prismadb.clothingItem.updateMany({
    where: { id: itemId, status: 'analyzing' },
    data: { status: previousStatus === 'completed' ? 'completed' : 'failed' },
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
