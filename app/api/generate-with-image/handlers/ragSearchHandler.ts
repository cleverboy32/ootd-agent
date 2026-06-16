import { searchWardrobeItemsByText, WardrobeSearchResult } from '../../../../server/services/wardrobeService';
import { buildRagSearchLogEntry, logRagSearch } from '../../../../server/services/ragAuditLogger';
import {
  normalizeWardrobeSearchInput,
  resolveMainCategoryForSlot,
  WardrobeSearchInput,
} from '../../../../server/utils/ragSearchSlots';
import { ClothingItem } from '@prisma/client';
import type { AnchorItemInfo, GatekeeperIntent } from './intentTypes';

export type { WardrobeSearchInput, WardrobeSearchQuery } from '../../../../server/utils/ragSearchSlots';

export interface RagSearchContext {
  source?: string;
  conversationId?: string;
  userMessage?: string;
  intent?: GatekeeperIntent;
  anchorItem?: AnchorItemInfo;
}

/**
 * Formats the search results into an XML string for the AI prompt.
 * @param items The search results from the wardrobe.
 * @returns An XML-formatted string of wardrobe items.
 */
function formatResultsToXml(items: WardrobeSearchResult[]): string {
  if (items.length === 0) {
    return '';
  }

  const itemsXml = items
    .map(
      (item) =>
        // 使用 item.id, item.mainCategory, etc.
        `  <item id="${item.id}" name="${item.subCategory}" description="${item.description || ''}" colors="${item.colors.join(', ')}"/>`
    )
    .join('\n');

  return `\n<relevant_wardrobe_items>\n${itemsXml}\n</relevant_wardrobe_items>\n`;
}

/**
 * Performs a RAG search against the user's wardrobe using stylist-provided queries.
 * @param searchQueries Search queries from the Stylist Agent.
 * @param userId The user's ID.
 * @param ragCache A cache to store search results for the current request.
 * @returns An object containing the XML string for the prompt and the found items.
 */
export async function performRagSearch(
  searchQueries: WardrobeSearchInput[],
  userId: string,
  ragCache: Map<string, ClothingItem>,
  logContext?: RagSearchContext
): Promise<{ xmlString: string; items: ClothingItem[] }> {
  console.log('[RAG_HANDLER] Starting RAG search process...');

  const queries = searchQueries
    .map(normalizeWardrobeSearchInput)
    .filter((item) => item.query.length > 0);
  if (queries.length === 0) {
    console.log('[RAG_HANDLER] No search queries provided. Skipping RAG search.');
    return { xmlString: '', items: [] };
  }

  console.log('[RAG_HANDLER] Searching wardrobe with queries:', queries);

  try {
    const seenIds = new Set<string>();
    const mergedResults: WardrobeSearchResult[] = [];
    const perQueryResults: Array<{
      query: string;
      slot?: string;
      mainCategory?: string;
      results: WardrobeSearchResult[];
    }> = [];

    for (const { query, slot } of queries) {
      const mainCategory = resolveMainCategoryForSlot(slot);
      const searchResults = await searchWardrobeItemsByText(query, userId, 5, mainCategory);
      perQueryResults.push({
        query,
        slot,
        mainCategory,
        results: searchResults,
      });
      for (const item of searchResults) {
        if (!seenIds.has(item.id)) {
          seenIds.add(item.id);
          mergedResults.push(item);
        }
      }
    }

    await logRagSearch(
      buildRagSearchLogEntry({
        userId,
        queries: queries.map(({ query, slot }) => ({
          query,
          slot,
          mainCategory: resolveMainCategoryForSlot(slot),
        })),
        perQueryResults,
        mergedResults,
        source: logContext?.source,
        conversationId: logContext?.conversationId,
        userMessage: logContext?.userMessage,
        intent: logContext?.intent,
        anchorItem: logContext?.anchorItem,
      })
    );

    if (mergedResults.length === 0) {
      console.log('[RAG_HANDLER] No relevant items found in wardrobe.');
      return { xmlString: '', items: [] };
    }

    console.log(`[RAG_HANDLER] Found ${mergedResults.length} unique items. Caching and formatting to XML.`);

    const clothingItems: ClothingItem[] = mergedResults.map((result) => ({
      ...result,
      clientProfileId: userId,
      season: [],
      material: [],
      tags: [],
      embedding: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    clothingItems.forEach((item) => ragCache.set(item.id, item));

    const xmlString = formatResultsToXml(mergedResults);

    return {
      xmlString,
      items: clothingItems,
    };
  } catch (error) {
    console.error('[RAG_HANDLER] Error during RAG search:', error);
    return { xmlString: '', items: [] };
  }
}

