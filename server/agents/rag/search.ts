import { searchWardrobeItemsByText, WardrobeSearchResult } from '@/server/services/wardrobeService';
import { buildRagSearchLogEntry, logRagSearch } from '@/server/logging/rag';
import {
  normalizeWardrobeSearchInput,
  parseWardrobeSearchSlot,
  resolveMainCategoryForSlot,
  WardrobeSearchInput,
} from '@/server/utils/ragSearchSlots';
import {
  applySeasonFilter,
  buildSeasonFilterContext,
  expandedSearchLimit,
} from '@/server/utils/ragSeasonFilter';
import { ClothingItem } from '@prisma/client';
import type { AnchorItemInfo, GatekeeperIntent } from '../intent';

export type { WardrobeSearchInput, WardrobeSearchQuery } from '@/server/utils/ragSearchSlots';

export interface RagSearchContext {
  source?: string;
  conversationId?: string;
  userMessage?: string;
  intent?: GatekeeperIntent;
  anchorItem?: AnchorItemInfo;
}

function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
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
    .map((item) => {
      const season = (item.season ?? []).join(', ');
      const tags = (item.tags ?? []).join(', ');
      const similarity =
        typeof item.similarity === 'number' ? item.similarity.toFixed(2) : '';
      return `  <item id="${item.id}" name="${escapeXmlAttr(item.subCategory)}" subCategory="${escapeXmlAttr(item.subCategory)}" similarity="${similarity}" description="${escapeXmlAttr(item.description || '')}" colors="${escapeXmlAttr(item.colors.join(', '))}" season="${escapeXmlAttr(season)}" tags="${escapeXmlAttr(tags)}"/>`;
    })
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
    const seasonContext = buildSeasonFilterContext(logContext?.intent, logContext?.userMessage);
    const resultLimit = 5;
    const fetchLimit = expandedSearchLimit(seasonContext, resultLimit);

    if (seasonContext.isWarmWeather) {
      console.log(
        `[RAG_HANDLER] Warm-season filter active. targetSeasons=${seasonContext.targetSeasons.join(',')}`
      );
    } else {
      console.log(
        `[RAG_HANDLER] Cold-season filter active. targetSeasons=${seasonContext.targetSeasons.join(',')}` +
          (seasonContext.strictColdActivity ? ', strictColdActivity=true' : '')
      );
    }

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
      const parsedSlot = parseWardrobeSearchSlot(slot);
      const rawResults = await searchWardrobeItemsByText(query, userId, fetchLimit, mainCategory);
      const searchResults = applySeasonFilter(rawResults, seasonContext, parsedSlot, resultLimit);
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
        seasonFilter: {
          dressingClimate: seasonContext.dressingClimate,
          targetSeasons: seasonContext.targetSeasons,
          isWarmWeather: seasonContext.isWarmWeather,
          strictColdActivity: seasonContext.strictColdActivity,
        },
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
      season: result.season ?? [],
      material: result.material ?? [],
      tags: result.tags ?? [],
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

