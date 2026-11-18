/**
 * RAG 单槽召回为空时的原因推断（供 audit / 单测）。
 * 优先使用 searchWardrobeItemsByText 上报的 failureReason。
 */

export type WardrobeSearchFailureReason =
  | 'empty_query'
  | 'missing_main_category'
  | 'embedding_empty'
  | 'search_exception'
  | 'no_db_rows'
  | 'all_below_threshold';

export type RagSlotEmptyReason =
  | WardrobeSearchFailureReason
  | 'skipped_no_main_category'
  | 'emptied_by_slot_temp'
  | 'emptied_by_athletic'
  | 'emptied_by_style'
  | 'unknown_empty';

export type RagRetrievalStageCounts = {
  db_top_k_after_category_and_sql_temp_filters: number;
  post_similarity_threshold: number;
  post_slot_temperature_filter: number;
  post_result_limit: number;
  post_athletic_filter: number;
  final_after_style_filter: number;
};

export function resolveSlotRetrievalEmptyReason(input: {
  finalCount: number;
  searchFailureReason?: WardrobeSearchFailureReason | null;
  stageCounts: RagRetrievalStageCounts;
}): RagSlotEmptyReason | null {
  if (input.finalCount > 0) return null;
  if (input.searchFailureReason) return input.searchFailureReason;

  const c = input.stageCounts;
  if (c.db_top_k_after_category_and_sql_temp_filters === 0) return 'no_db_rows';
  if (c.post_similarity_threshold === 0) return 'all_below_threshold';
  if (c.post_slot_temperature_filter === 0) return 'emptied_by_slot_temp';
  if (c.post_athletic_filter === 0 && c.post_slot_temperature_filter > 0) {
    return 'emptied_by_athletic';
  }
  if (c.final_after_style_filter === 0 && c.post_athletic_filter > 0) {
    return 'emptied_by_style';
  }
  return 'unknown_empty';
}

export function serializeSearchError(error: unknown): { name: string; message: string } {
  if (error instanceof Error) {
    return { name: error.name || 'Error', message: error.message || String(error) };
  }
  return { name: 'Error', message: String(error) };
}
