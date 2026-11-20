import {
  searchWardrobeItemsByText,
  type WardrobeSearchDiagnostics,
  type WardrobeSearchResult,
} from '@/server/services/wardrobeService';
import { buildRagSearchLogEntry, logRagSearch } from '@/server/logging/rag';
import {
  collapseQueriesForRound,
  normalizeWardrobeSearchInput,
  parseWardrobeSearchSlot,
  resolveMainCategoryForSlot,
  WardrobeSearchInput,
  type WardrobeSearchQuery,
} from '@/server/utils/ragSearchSlots';
import {
  applySlotTemperatureFilter,
  resolveDressingFromWeather,
  type TempRange,
} from '@/server/utils/slotTempFilter';
import {
  buildSlotMatchAssessments,
  filterResultsForAthleticContext,
  formatSlotMatchSummaryXml,
  isAthleticOccasion,
} from '@/server/utils/ragMatchQuality';
import { filterResultsByStyleSkill } from '@/server/utils/queryStyleFilter';
import {
  resolveSlotRetrievalEmptyReason,
  serializeSearchError,
  type RagRetrievalStageCounts,
  type RagSlotEmptyReason,
  type WardrobeSearchFailureReason,
} from '@/server/utils/ragSearchDiagnostics';
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
  candidates: Array<{
    id: string;
    subCategory: string;
    similarity: number;
    mainCategory?: string;
    colors?: string[];
    tags?: string[];
    material?: string[];
    silhouette?: string[];
    occasions?: string[];
    formality?: string | null;
    description?: string | null;
    tempMin?: number | null;
    tempMax?: number | null;
    imageUrl?: string;
  }>;
  query?: string;
  target?: string;
  temp_range?: TempRange | null;
  /** Evaluation-only candidates at each retrieval/filter stage. */
  candidate_stages?: Record<string, Array<{ id: string; subCategory: string; similarity: number }>>;
  /** 各过滤阶段候选数（生产 audit 也写） */
  retrieval_stage_counts?: RagRetrievalStageCounts;
  /** 该槽最终无召回时的原因 */
  empty_reason?: RagSlotEmptyReason | null;
  search_error?: { name: string; message: string };
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
      const material = (item.material ?? []).join(', ');
      const occasions = (item.occasions ?? []).join(', ');
      const silhouette = (item.silhouette ?? []).join(', ');
      const formality = item.formality ?? '';
      const tempMin =
        item.tempMin === null || item.tempMin === undefined ? '' : String(item.tempMin);
      const tempMax =
        item.tempMax === null || item.tempMax === undefined ? '' : String(item.tempMax);
      const similarity =
        typeof item.similarity === 'number' ? item.similarity.toFixed(2) : '';
      const meta = metaById?.get(item.id);
      const outfitsAttr = meta?.outfitIds?.length
        ? ` outfits="${escapeXmlAttr(meta.outfitIds.join(','))}"`
        : '';
      const slotsAttr = meta?.slots?.length
        ? ` slots="${escapeXmlAttr(meta.slots.join(','))}"`
        : '';
      return `  <item ref="${ref}" name="${escapeXmlAttr(item.subCategory)}" subCategory="${escapeXmlAttr(item.subCategory)}" mainCategory="${escapeXmlAttr(item.mainCategory)}" similarity="${similarity}" description="${escapeXmlAttr(item.description || '')}" colors="${escapeXmlAttr(item.colors.join(', '))}" season="${escapeXmlAttr(season)}" tags="${escapeXmlAttr(tags)}" material="${escapeXmlAttr(material)}" occasions="${escapeXmlAttr(occasions)}" formality="${escapeXmlAttr(formality)}" silhouette="${escapeXmlAttr(silhouette)}" tempMin="${escapeXmlAttr(tempMin)}" tempMax="${escapeXmlAttr(tempMax)}"${outfitsAttr}${slotsAttr}/>`;
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
  slotTempRange: TempRange | null,
  athletic: boolean,
  skillNames: string[] | undefined,
  captureDiagnostics: boolean
): Promise<{
  results: WardrobeSearchResult[];
  candidateStages?: Record<string, WardrobeSearchResult[]>;
  retrievalStageCounts: RagRetrievalStageCounts;
  emptyReason: RagSlotEmptyReason | null;
  searchError?: { name: string; message: string };
  similarityThreshold?: number;
}> {
  const emptyStages = (): RagRetrievalStageCounts => ({
    db_top_k_after_category_and_sql_temp_filters: 0,
    post_similarity_threshold: 0,
    post_slot_temperature_filter: 0,
    post_result_limit: 0,
    post_athletic_filter: 0,
    final_after_style_filter: 0,
  });

  const mainCategory = resolveMainCategoryForSlot(slot);
  const parsedSlot = parseWardrobeSearchSlot(slot);
  if (!mainCategory) {
    console.warn(
      `[RAG_HANDLER] Skipping search: slot="${slot ?? ''}" did not resolve to mainCategory (query="${query.slice(0, 48)}")`
    );
    return {
      results: [],
      retrievalStageCounts: emptyStages(),
      emptyReason: 'skipped_no_main_category',
    };
  }
  const searchQuery = query;
  let databaseCandidates: WardrobeSearchResult[] = [];
  let searchFailureReason: WardrobeSearchFailureReason | null = null;
  let searchError: { name: string; message: string } | undefined;
  let similarityThreshold: number | undefined;

  const rawResults = await searchWardrobeItemsByText(searchQuery, userId, fetchLimit, mainCategory, {
    slot: parsedSlot,
    slotTempRange,
    onSearchDiagnostics: (diagnostics: WardrobeSearchDiagnostics) => {
      databaseCandidates = diagnostics.databaseCandidates;
      searchFailureReason = diagnostics.failureReason;
      searchError = diagnostics.error;
      similarityThreshold = diagnostics.similarityThreshold;
    },
  });
  const postTemperatureFilter = applySlotTemperatureFilter(rawResults, slotTempRange);
  const postResultLimit = postTemperatureFilter.slice(0, resultLimit);
  const athleticFiltered = filterResultsForAthleticContext(
    postResultLimit,
    parsedSlot,
    athletic
  );

  const beforeStyle = athleticFiltered.length;
  const searchResults = filterResultsByStyleSkill(athleticFiltered, skillNames, parsedSlot);
  if (searchResults.length !== beforeStyle) {
    console.log(
      `[RAG_HANDLER] style filter slot=${parsedSlot ?? '?'} ` +
        `skills=${(skillNames ?? []).join('|') || 'none'}: ` +
        `${beforeStyle} → ${searchResults.length}`
    );
  }

  const retrievalStageCounts: RagRetrievalStageCounts = {
    db_top_k_after_category_and_sql_temp_filters: databaseCandidates.length,
    post_similarity_threshold: rawResults.length,
    post_slot_temperature_filter: postTemperatureFilter.length,
    post_result_limit: postResultLimit.length,
    post_athletic_filter: athleticFiltered.length,
    final_after_style_filter: searchResults.length,
  };
  const emptyReason = resolveSlotRetrievalEmptyReason({
    finalCount: searchResults.length,
    searchFailureReason,
    stageCounts: retrievalStageCounts,
  });
  if (emptyReason) {
    console.warn(
      `[RAG_HANDLER] slot=${parsedSlot ?? slot ?? '?'} emptyReason=${emptyReason}` +
        (searchError ? ` error=${searchError.name}:${searchError.message}` : '') +
        ` stages=${JSON.stringify(retrievalStageCounts)}`
    );
  }

  return {
    results: searchResults,
    retrievalStageCounts,
    emptyReason,
    ...(searchError ? { searchError } : {}),
    ...(similarityThreshold != null ? { similarityThreshold } : {}),
    ...(captureDiagnostics
      ? {
          candidateStages: {
            db_top_k_after_category_and_sql_temp_filters: databaseCandidates,
            post_similarity_threshold: rawResults,
            post_slot_temperature_filter: postTemperatureFilter,
            post_result_limit: postResultLimit,
            post_athletic_filter: athleticFiltered,
            final_after_style_filter: searchResults,
          },
        }
      : {}),
  };
}

/**
 * Performs a RAG search against the user's wardrobe using stylist-provided queries.
 * Supports Plan→Retrieve: queries may carry outfitId.
 * 有 style-*：按 slot+query collapse；无 style：按 slot 合并（整轮每槽一次）。
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

  const hasStyleSkill = (logContext?.skillNames ?? []).some((name) =>
    name.startsWith('style-')
  );
  const sharedPoolBySlot = !hasStyleSkill;
  const weather = logContext?.intent?.weather?.trim() ?? '';
  const dressing = resolveDressingFromWeather(weather);
  const outfitsWithInnerBottom = new Set(
    queries.filter((item) => parseWardrobeSearchSlot(item.slot) === 'inner_bottom')
      .map((item) => item.outfitId)
  );
  const isLayeredColdBottom = ({
    slot,
    outfitId,
  }: Pick<WardrobeSearchQuery, 'slot' | 'outfitId'>) =>
    dressing?.band === 'cold' &&
    parseWardrobeSearchSlot(slot) === 'bottom' &&
    outfitsWithInnerBottom.has(outfitId);
  const collapsed = collapseQueriesForRound(queries, {
    sharedPoolBySlot,
    filterKey: (item) => (isLayeredColdBottom(item) ? 'layered_bottom' : ''),
  });
  console.log(
    `[RAG_HANDLER] Searching wardrobe: ${queries.length} slot queries → ${collapsed.length} unique` +
      (sharedPoolBySlot ? ' (by slot, no-style shared pool)' : ' (slot+query)')
  );

  try {
    const resultLimit = 5;
    const fetchLimit = Math.max(resultLimit * 2, 10);

    const athletic = isAthleticOccasion(logContext?.intent, logContext?.userMessage);
    if (athletic) {
      console.log('[RAG_HANDLER] Athletic occasion detected — applying slot fitness filter');
    }

    if (dressing) {
      const adj =
        dressing.adjustments.length > 0 ? `；${dressing.adjustments.join('；')}` : '';
      console.log(
        `[RAG_HANDLER] Slot temp-range filter active: ambient≈${dressing.tempCelsius}℃ feelsLike≈${dressing.feelsLikeCelsius}℃ band=${dressing.band}${adj}`
      );
    }

    console.log(`[RAG_HANDLER] Running ${collapsed.length} searches in parallel...`);

    const collapsedResults = await Promise.all(
      collapsed.map(async (group) => {
        const withInnerBottom = isLayeredColdBottom({
          slot: group.slot,
          outfitId: group.outfitIds[0],
        });
        const slotTempRange = dressing?.slotRange(group.slot, withInnerBottom) ?? null;
        const search = await runOneSlotSearch(
          group.query,
          group.slot,
          userId,
          fetchLimit,
          resultLimit,
          slotTempRange,
          athletic,
          logContext?.skillNames,
          logContext?.source === 'eval-retrieve'
        );
        return { group, slotTempRange, ...search };
      })
    );

    // Expand back to per-(outfitId,slot) for assessments / snapshots / logs
    const perQueryResults: Array<{
      query: string;
      slot?: string;
      outfitId?: string;
      target?: string;
      slotTempRange: TempRange | null;
      mainCategory?: ReturnType<typeof resolveMainCategoryForSlot>;
      results: WardrobeSearchResult[];
      candidateStages?: Record<string, WardrobeSearchResult[]>;
      retrievalStageCounts: RagRetrievalStageCounts;
      emptyReason: RagSlotEmptyReason | null;
      searchError?: { name: string; message: string };
      similarityThreshold?: number;
    }> = [];

    for (const {
      group,
      slotTempRange,
      results,
      candidateStages,
      retrievalStageCounts,
      emptyReason,
      searchError,
      similarityThreshold,
    } of collapsedResults) {
      const outfitIds = group.outfitIds.length > 0 ? group.outfitIds : [undefined];
      for (const outfitId of outfitIds) {
        perQueryResults.push({
          query: group.query,
          slot: group.slot,
          outfitId,
          target: group.target,
          slotTempRange,
          mainCategory: resolveMainCategoryForSlot(group.slot),
          results,
          candidateStages,
          retrievalStageCounts,
          emptyReason,
          ...(searchError ? { searchError } : {}),
          ...(similarityThreshold != null ? { similarityThreshold } : {}),
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
          dressingClimate: '',
          targetSeasons: [],
          isWarmWeather: dressing !== null ? dressing.feelsLikeCelsius >= 23 : false,
          strictColdActivity: false,
        },
        skillNames: logContext?.skillNames,
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
          mainCategory: item.mainCategory,
          colors: item.colors,
          tags: item.tags ?? [],
          material: item.material ?? [],
          silhouette: item.silhouette ?? [],
          occasions: item.occasions ?? [],
          formality: item.formality ?? null,
          description: item.description ?? null,
          tempMin: item.tempMin ?? null,
          tempMax: item.tempMax ?? null,
          imageUrl: item.imageUrl,
        })),
        query: row.query,
        target: row.target,
        temp_range: row.slotTempRange,
        retrieval_stage_counts: row.retrievalStageCounts,
        empty_reason: row.emptyReason,
        ...(row.searchError ? { search_error: row.searchError } : {}),
        ...(row.candidateStages
          ? {
              candidate_stages: Object.fromEntries(
                Object.entries(row.candidateStages).map(([stage, stageItems]) => [
                  stage,
                  stageItems.map((item) => ({
                    id: item.id,
                    subCategory: item.subCategory,
                    similarity: item.similarity,
                  })),
                ])
              ),
            }
          : {}),
      };
    });

    if (mergedResults.length === 0) {
      const reasons = perQueryResults.map(
        (row) => `${row.slot ?? '?'}:${row.emptyReason ?? 'unknown_empty'}`
      );
      console.log(
        `[RAG_HANDLER] No relevant items found in wardrobe. emptyReasons=[${reasons.join(', ')}]`
      );
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
      occasions: result.occasions ?? [],
      formality: result.formality ?? null,
      silhouette: result.silhouette ?? [],
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
    const serialized = serializeSearchError(error);
    console.error('[RAG_HANDLER] Error during RAG search:', serialized, error);
    try {
      await logRagSearch(
        buildRagSearchLogEntry({
          userId,
          queries: searchQueries
            .map(normalizeWardrobeSearchInput)
            .filter((item) => item.query.length > 0)
            .map(({ query, slot, outfitId }) => ({
              query,
              slot,
              outfitId,
              mainCategory: resolveMainCategoryForSlot(slot),
            })),
          perQueryResults: [],
          mergedResults: [],
          source: logContext?.source,
          conversationId: logContext?.conversationId,
          userMessage: logContext?.userMessage,
          intent: logContext?.intent,
          anchorItem: logContext?.anchorItem,
          skillNames: logContext?.skillNames,
          handlerError: serialized,
        })
      );
    } catch (logError) {
      console.error('[RAG_HANDLER] Failed to write RAG error audit:', logError);
    }
    return {
      xmlString: '',
      indexMap: new Map(),
      items: [],
      matchSummaryXml: '',
      slotSnapshots: [],
    };
  }
}
