import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  resolveSlotRetrievalEmptyReason,
  serializeSearchError,
  type RagRetrievalStageCounts,
} from '@/server/utils/ragSearchDiagnostics';
import { buildRagSearchLogEntry } from '@/server/logging/rag';

const zeroStages = (): RagRetrievalStageCounts => ({
  db_top_k_after_category_and_sql_temp_filters: 0,
  post_similarity_threshold: 0,
  post_slot_temperature_filter: 0,
  post_result_limit: 0,
  post_athletic_filter: 0,
  final_after_style_filter: 0,
});

describe('resolveSlotRetrievalEmptyReason', () => {
  it('returns null when final candidates exist', () => {
    const stages = zeroStages();
    stages.final_after_style_filter = 2;
    assert.equal(
      resolveSlotRetrievalEmptyReason({
        finalCount: 2,
        searchFailureReason: 'no_db_rows',
        stageCounts: stages,
      }),
      null
    );
  });

  it('prefers searchFailureReason from wardrobe search', () => {
    assert.equal(
      resolveSlotRetrievalEmptyReason({
        finalCount: 0,
        searchFailureReason: 'search_exception',
        stageCounts: zeroStages(),
      }),
      'search_exception'
    );
  });

  it('detects threshold wipe when DB had rows', () => {
    const stages = zeroStages();
    stages.db_top_k_after_category_and_sql_temp_filters = 3;
    assert.equal(
      resolveSlotRetrievalEmptyReason({
        finalCount: 0,
        stageCounts: stages,
      }),
      'all_below_threshold'
    );
  });

  it('detects style filter wipe', () => {
    const stages: RagRetrievalStageCounts = {
      db_top_k_after_category_and_sql_temp_filters: 3,
      post_similarity_threshold: 3,
      post_slot_temperature_filter: 3,
      post_result_limit: 3,
      post_athletic_filter: 3,
      final_after_style_filter: 0,
    };
    assert.equal(
      resolveSlotRetrievalEmptyReason({
        finalCount: 0,
        stageCounts: stages,
      }),
      'emptied_by_style'
    );
  });
});

describe('serializeSearchError', () => {
  it('serializes Error instances', () => {
    assert.deepEqual(serializeSearchError(new TypeError('boom')), {
      name: 'TypeError',
      message: 'boom',
    });
  });
});

describe('buildRagSearchLogEntry empty diagnostics', () => {
  it('persists emptyReason, stage counts, and searchError', () => {
    const entry = buildRagSearchLogEntry({
      userId: 'u1',
      queries: [{ query: 'q', slot: 'outerwear', mainCategory: 'OUTERWEAR' }],
      perQueryResults: [
        {
          query: 'q',
          slot: 'outerwear',
          mainCategory: 'OUTERWEAR',
          results: [],
          emptyReason: 'search_exception',
          retrievalStageCounts: zeroStages(),
          similarityThreshold: 0.48,
          searchError: { name: 'Error', message: 'db down' },
        },
      ],
      mergedResults: [],
      skillNames: ['style-literary'],
    });

    assert.equal(entry.totalUniqueItems, 0);
    assert.equal(entry.skillNames?.[0], 'style-literary');
    assert.equal(entry.perQueryResults[0]?.emptyReason, 'search_exception');
    assert.equal(entry.perQueryResults[0]?.searchError?.message, 'db down');
    assert.equal(
      entry.perQueryResults[0]?.retrievalStageCounts?.db_top_k_after_category_and_sql_temp_filters,
      0
    );
  });
});
