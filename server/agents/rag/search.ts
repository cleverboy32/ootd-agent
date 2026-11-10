import { searchWardrobeItemsByText, WardrobeSearchResult } from '@/server/services/wardrobeService';
import { buildRagSearchLogEntry, logRagSearch } from '@/server/logging/rag';
import {
  collapseIdenticalSlotQueries,
  normalizeWardrobeSearchInput,
  parseWardrobeSearchSlot,
  resolveMainCategoryForSlot,
  WardrobeSearchInput,
  WardrobeSearchQuery,
} from '@/server/utils/ragSearchSlots';
import {
  applySeasonFilter,
  applyTemperatureFilter,
  buildSeasonFilterContext,
  expandedSearchLimit,
  filterCoolUnseasonalItems,
  parseTemperatureCelsius,
} from '@/server/utils/ragSeasonFilter';
import {
  buildSlotMatchAssessments,
  filterResultsForAthleticContext,
  formatSlotMatchSummaryXml,
  isAthleticOccasion,
} from '@/server/utils/ragMatchQuality';
import { filterResultsByQueryCategory } from '@/server/utils/queryCategoryFilter';
import { filterResultsByStyleSkill } from '@/server/utils/queryStyleFilter';
import { ClothingItem } from '@prisma/client';
import type { AnchorItemInfo, GatekeeperIntent } from '../intent';

export type { WardrobeSearchInput, WardrobeSearchQuery } from '@/server/utils/ragSearchSlots';

export interface RagSearchContext {
  source?: string;
  conversationId?: string;
  userMessage?: string;
  intent?: GatekeeperIntent;
  anchorItem?: AnchorItemInfo;
  /** 本轮注入的 stylist skills（用于风格一致性过滤；无 style-* 则跳过） */
  skillNames?: string[];
}

export type RagSlotSnapshot = {
  slot: string;
  outfitId?: string;
  matchStatus?: 'adequate' | 'weak' | 'none';
  bestSimilarity?: number;
  candidates: Array<{ id: string; subCategory: string; similarity: number }>;
  query?: string;
  target?: string;
};

function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

/**
 * Formats search results into XML for the reconcile prompt.
 * Groups by outfitId when present; uses short ref tokens (item_0…).
 */
function formatResultsToXml(
  items: WardrobeSearchResult[],
  metaById?: Map<string, { outfitIds: string[]; slots: string[] }>
): {
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
      const meta = metaById?.get(item.id);
      const outfitsAttr = meta?.outfitIds?.length
        ? ` outfits="${escapeXmlAttr(meta.outfitIds.join(','))}"`
        : '';
      const slotsAttr = meta?.slots?.length
        ? ` slots="${escapeXmlAttr(meta.slots.join(','))}"`
        : '';
      return `  <item ref="${ref}" name="${escapeXmlAttr(item.subCategory)}" subCategory="${escapeXmlAttr(item.subCategory)}" mainCategory="${escapeXmlAttr(item.mainCategory)}" similarity="${similarity}" description="${escapeXmlAttr(item.description || '')}" colors="${escapeXmlAttr(item.colors.join(', '))}" season="${escapeXmlAttr(season)}" tags="${escapeXmlAttr(tags)}"${outfitsAttr}${slotsAttr}/>`;
    })
    .join('\n');

  return {
    xml: `\n<relevant_wardrobe_items>\n${itemsXml}\n</relevant_wardrobe_items>\n`,
    indexMap,
  };
}

async function runOneSlotSearch(
  query: string,
  slot: string | undefined,
  userId: string,
  fetchLimit: number,
  resultLimit: number,
  temperature: number | null,
  seasonContext: ReturnType<typeof buildSeasonFilterContext>,
  athletic: boolean,
  skillNames: string[] | undefined
): Promise<WardrobeSearchResult[]> {
  const mainCategory = resolveMainCategoryForSlot(slot);
  const parsedSlot = parseWardrobeSearchSlot(slot);
  const searchQuery = query;
  const rawResults = await searchWardrobeItemsByText(searchQuery, userId, fetchLimit, mainCategory, {
    slot: parsedSlot,
    temperatureCelsius: temperature,
  });
  const temperatureFiltered = applyTemperatureFilter(rawResults, temperature);
  const seasonFiltered = applySeasonFilter(
    temperatureFiltered,
    seasonContext,
    parsedSlot,
    resultLimit
  );
  const athleticFiltered = filterResultsForAthleticContext(
    seasonFiltered,
    parsedSlot,
    athletic
  );
  const beforeCategory = athleticFiltered.length;
  const categoryFiltered = filterResultsByQueryCategory(
    athleticFiltered,
    searchQuery,
    parsedSlot
  );
  if (categoryFiltered.length !== beforeCategory) {
    console.log(
      `[RAG_HANDLER] query-category filter slot=${parsedSlot ?? '?'} ` +
        `"${searchQuery}": ${beforeCategory} → ${categoryFiltered.length}`
    );
  }

  const beforeCool = categoryFiltered.length;
  const coolFiltered = filterCoolUnseasonalItems(categoryFiltered, temperature);
  if (coolFiltered.length !== beforeCool) {
    console.log(
      `[RAG_HANDLER] cool-unseasonal filter slot=${parsedSlot ?? '?'} ` +
        `${temperature}℃: ${beforeCool} → ${coolFiltered.length}`
    );
  }

  const beforeStyle = coolFiltered.length;
  const searchResults = filterResultsByStyleSkill(coolFiltered, skillNames, parsedSlot);
  if (searchResults.length !== beforeStyle) {
    console.log(
      `[RAG_HANDLER] style filter slot=${parsedSlot ?? '?'} ` +
        `skills=${(skillNames ?? []).join('|') || 'none'}: ` +
        `${beforeStyle} → ${searchResults.length}`
    );
  }

  return searchResults;
}

/**
 * Performs a RAG search against the user's wardrobe using stylist-provided queries.
 * Supports Plan→Retrieve: queries may carry outfitId; identical slot+query are collapsed
 * into one vector search and results are shared across outfitIds.
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
  slotSnapshots: RagSlotSnapshot[];
}> {
  console.log('[RAG_HANDLER] Starting RAG search process...');

  const empty = {
    xmlString: '',
    indexMap: new Map<string, string>(),
    items: [] as ClothingItem[],
    matchSummaryXml: '',
    slotSnapshots: [] as RagSlotSnapshot[],
  };

  const queries = searchQueries
    .map(normalizeWardrobeSearchInput)
    .filter((item) => item.query.length > 0);
  if (queries.length === 0) {
    console.log('[RAG_HANDLER] No search queries provided. Skipping RAG search.');
    return empty;
  }

  const collapsed = collapseIdenticalSlotQueries(queries);
  console.log(
    `[RAG_HANDLER] Searching wardrobe: ${queries.length} slot queries → ${collapsed.length} unique (slot+query)`
  );

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

    const athletic = isAthleticOccasion(logContext?.intent, logContext?.userMessage);
    if (athletic) {
      console.log('[RAG_HANDLER] Athletic occasion detected — applying slot fitness filter');
    }

    const temperature = parseTemperatureCelsius(logContext?.intent?.weather?.trim() ?? '');
    if (temperature !== null) {
      console.log(`[RAG_HANDLER] Temperature prefilter active: ${temperature}℃ (SQL + post-check)`);
    }

    console.log(`[RAG_HANDLER] Running ${collapsed.length} searches in parallel...`);

    const collapsedResults = await Promise.all(
      collapsed.map(async (group) => {
        const results = await runOneSlotSearch(
          group.query,
          group.slot,
          userId,
          fetchLimit,
          resultLimit,
          temperature,
          seasonContext,
          athletic,
          logContext?.skillNames
        );
        return { group, results };
      })
    );

    // Expand back to per-(outfitId,slot) for assessments / snapshots / logs
    const perQueryResults: Array<{
      query: string;
      slot?: string;
      outfitId?: string;
      target?: string;
      mainCategory?: ReturnType<typeof resolveMainCategoryForSlot>;
      results: WardrobeSearchResult[];
    }> = [];

    for (const { group, results } of collapsedResults) {
      const outfitIds = group.outfitIds.length > 0 ? group.outfitIds : [undefined];
      for (const outfitId of outfitIds) {
        perQueryResults.push({
          query: group.query,
          slot: group.slot,
          outfitId,
          target: group.target,
          mainCategory: resolveMainCategoryForSlot(group.slot),
          results,
        });
      }
    }

    const seenIds = new Set<string>();
    const mergedResults: WardrobeSearchResult[] = [];
    const metaById = new Map<string, { outfitIds: string[]; slots: string[] }>();

    for (const row of perQueryResults) {
      for (const item of row.results) {
        const meta = metaById.get(item.id) ?? { outfitIds: [], slots: [] };
        if (row.outfitId && !meta.outfitIds.includes(row.outfitId)) {
          meta.outfitIds.push(row.outfitId);
        }
        if (row.slot && !meta.slots.includes(row.slot)) {
          meta.slots.push(row.slot);
        }
        metaById.set(item.id, meta);
        if (!seenIds.has(item.id)) {
          seenIds.add(item.id);
          mergedResults.push(item);
        }
      }
    }

    await logRagSearch(
      buildRagSearchLogEntry({
        userId,
        queries: perQueryResults.map(({ query, slot, outfitId, mainCategory }) => ({
          query,
          slot,
          outfitId,
          mainCategory,
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

    const hasStyleSkill = (logContext?.skillNames ?? []).some((name) =>
      name.startsWith('style-')
    );
    const slotAssessments = buildSlotMatchAssessments(
      perQueryResults,
      logContext?.intent,
      logContext?.userMessage,
      { promoteGrayWhenCoarse: !hasStyleSkill }
    );
    const slotSnapshots: RagSlotSnapshot[] = perQueryResults.map((row, idx) => {
      const assessment = slotAssessments[idx];
      return {
        slot: row.slot ?? assessment?.slot ?? 'unknown',
        outfitId: row.outfitId,
        matchStatus: assessment?.status,
        bestSimilarity: assessment?.bestSimilarity,
        candidates: row.results.map((item) => ({
          id: item.id,
          subCategory: item.subCategory,
          similarity: item.similarity,
        })),
        query: row.query,
        target: row.target,
      };
    });

    if (mergedResults.length === 0) {
      console.log('[RAG_HANDLER] No relevant items found in wardrobe.');
      return { ...empty, slotSnapshots };
    }

    console.log(`[RAG_HANDLER] Found ${mergedResults.length} unique items. Caching and formatting to XML.`);

    const clothingItems: ClothingItem[] = mergedResults.map((result) => ({
      ...result,
      userId,
      status: 'completed' as const,
      season: result.season ?? [],
      material: result.material ?? [],
      tags: result.tags ?? [],
      searchDescription: null,
      occasions: [],
      formality: null,
      silhouette: [],
      embedding: null,
      tempMin: result.tempMin ?? null,
      tempMax: result.tempMax ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    clothingItems.forEach((item) => ragCache.set(item.id, item));

    const matchSummaryXml = formatSlotMatchSummaryXml(slotAssessments, athletic);
    if (matchSummaryXml) {
      console.log('[RAG_HANDLER] Slot match summary:', slotAssessments);
    }

    // Per-outfit plan brief for reconcile
    const planBriefParts: string[] = [];
    const byOutfit = new Map<string, RagSlotSnapshot[]>();
    for (const snap of slotSnapshots) {
      const key = snap.outfitId || '_global';
      const list = byOutfit.get(key) ?? [];
      list.push(snap);
      byOutfit.set(key, list);
    }
    for (const [outfitKey, snaps] of byOutfit) {
      const lines = snaps
        .map(
          (s) =>
            `  <slot name="${escapeXmlAttr(s.slot)}" status="${s.matchStatus ?? ''}" query="${escapeXmlAttr(s.query ?? '')}" target="${escapeXmlAttr(s.target ?? '')}" best="${s.bestSimilarity?.toFixed(2) ?? ''}"/>`
        )
        .join('\n');
      planBriefParts.push(
        `<outfit_retrieve id="${escapeXmlAttr(outfitKey)}">\n${lines}\n</outfit_retrieve>`
      );
    }
    const retrieveBriefXml =
      planBriefParts.length > 0
        ? `\n<outfit_retrieve_summary>\n${planBriefParts.join('\n')}\n</outfit_retrieve_summary>\n`
        : '';

    const { xml: xmlString, indexMap } = formatResultsToXml(mergedResults, metaById);
    console.log('[RAG_HANDLER] Index map:', Object.fromEntries(indexMap));

    return {
      xmlString: matchSummaryXml + retrieveBriefXml + xmlString,
      indexMap,
      items: clothingItems,
      matchSummaryXml,
      slotSnapshots,
    };
  } catch (error) {
    console.error('[RAG_HANDLER] Error during RAG search:', error);
    return {
      xmlString: '',
      indexMap: new Map(),
      items: [],
      matchSummaryXml: '',
      slotSnapshots: [],
    };
  }
}
