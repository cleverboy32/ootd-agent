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
import {
  buildSlotMatchAssessments,
  filterResultsForAthleticContext,
  formatSlotMatchSummaryXml,
  isAthleticOccasion,
} from '@/server/utils/ragMatchQuality';
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
 * Uses short `ref` tokens (item_0, item_1…) instead of raw IDs to prevent LLM
 * from corrupting long cuid strings. The returned indexMap maps ref → real ID.
 */
function formatResultsToXml(items: WardrobeSearchResult[]): {
  xml: string;
  indexMap: Map<string, string>;
} {
  const indexMap = new Map<string, string>();
  if (items.length === 0) return { xml: '', indexMap };

  const itemsXml = items
    .map((item, i) => {
      const ref = `item_${i}`;
      indexMap.set(ref, item.id);
      const season = (item.season ?? []).join(', ');
      const tags = (item.tags ?? []).join(', ');
      const similarity =
        typeof item.similarity === 'number' ? item.similarity.toFixed(2) : '';
      return `  <item ref="${ref}" name="${escapeXmlAttr(item.subCategory)}" subCategory="${escapeXmlAttr(item.subCategory)}" similarity="${similarity}" description="${escapeXmlAttr(item.description || '')}" colors="${escapeXmlAttr(item.colors.join(', '))}" season="${escapeXmlAttr(season)}" tags="${escapeXmlAttr(tags)}"/>`;
    })
    .join('\n');

  return {
    xml: `\n<relevant_wardrobe_items>\n${itemsXml}\n</relevant_wardrobe_items>\n`,
    indexMap,
  };
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
): Promise<{
  xmlString: string;
  indexMap: Map<string, string>;
  items: ClothingItem[];
  matchSummaryXml: string;
}> {
  console.log('[RAG_HANDLER] Starting RAG search process...');

  const queries = searchQueries
    .map(normalizeWardrobeSearchInput)
    .filter((item) => item.query.length > 0);
  if (queries.length === 0) {
    console.log('[RAG_HANDLER] No search queries provided. Skipping RAG search.');
    return { xmlString: '', indexMap: new Map(), items: [], matchSummaryXml: '' };
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

    const athletic = isAthleticOccasion(logContext?.intent, logContext?.userMessage);
    if (athletic) {
      console.log('[RAG_HANDLER] Athletic occasion detected — applying slot fitness filter');
    }

    for (const { query, slot } of queries) {
      const mainCategory = resolveMainCategoryForSlot(slot);
      const parsedSlot = parseWardrobeSearchSlot(slot);
      const rawResults = await searchWardrobeItemsByText(query, userId, fetchLimit, mainCategory, {
        slot: parsedSlot,
        intent: logContext?.intent,
      });
      const seasonFiltered = applySeasonFilter(rawResults, seasonContext, parsedSlot, resultLimit);
      const searchResults = filterResultsForAthleticContext(seasonFiltered, parsedSlot, athletic);
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
      return { xmlString: '', indexMap: new Map(), items: [], matchSummaryXml: '' };
    }

    console.log(`[RAG_HANDLER] Found ${mergedResults.length} unique items. Caching and formatting to XML.`);

    const clothingItems: ClothingItem[] = mergedResults.map((result) => ({
      ...result,
      clientProfileId: userId,
      season: result.season ?? [],
      material: result.material ?? [],
      tags: result.tags ?? [],
      searchDescription: null,
      occasions: [],
      formality: null,
      silhouette: [],
      embedding: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    clothingItems.forEach((item) => ragCache.set(item.id, item));

    const slotAssessments = buildSlotMatchAssessments(perQueryResults, logContext?.intent, logContext?.userMessage);
    const matchSummaryXml = formatSlotMatchSummaryXml(slotAssessments, athletic);
    if (matchSummaryXml) {
      console.log('[RAG_HANDLER] Slot match summary:', slotAssessments);
    }

    const { xml: xmlString, indexMap } = formatResultsToXml(mergedResults);
    console.log('[RAG_HANDLER] Index map:', Object.fromEntries(indexMap));

    return {
      xmlString: matchSummaryXml + xmlString,
      indexMap,
      items: clothingItems,
      matchSummaryXml,
    };
  } catch (error) {
    console.error('[RAG_HANDLER] Error during RAG search:', error);
    return { xmlString: '', indexMap: new Map(), items: [], matchSummaryXml: '' };
  }
}

