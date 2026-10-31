import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  flattenOutfitPlanToQueries,
  planQueryBottomCategoryConflict,
} from '@/server/utils/outfitPlanSearch';
import { collapseIdenticalSlotQueries } from '@/server/utils/ragSearchSlots';
import { filterResultsByStyleSkill } from '@/server/utils/queryStyleFilter';
import type { WardrobeSearchResult } from '@/server/services/wardrobeService';

function item(
  overrides: Partial<WardrobeSearchResult> & Pick<WardrobeSearchResult, 'id' | 'subCategory'>
): WardrobeSearchResult {
  return {
    imageUrl: 'https://example.com/x.jpg',
    mainCategory: 'OUTERWEAR',
    description: '',
    colors: ['棕'],
    similarity: 0.7,
    season: ['spring', 'autumn'],
    material: [],
    tags: [],
    ...overrides,
  };
}

describe('flattenOutfitPlanToQueries', () => {
  it('展开为每套每槽一条且带 outfitId', () => {
    const queries = flattenOutfitPlanToQueries({
      outfits: [
        {
          id: 'outfit_1',
          overall_concept: '裙装',
          slots: [
            {
              slot: 'bottom',
              target: '藏青直筒裤',
              search_query: '法式九分直筒裤 藏青',
              allow_new: true,
            },
            {
              slot: 'top',
              target: '米白针织',
              search_query: '法式针织衫 米白',
              allow_new: true,
            },
          ],
        },
        {
          id: 'outfit_2',
          overall_concept: '裤装',
          slots: [
            {
              slot: 'bottom',
              target: '深棕半裙',
              search_query: '法式A字半裙 深棕',
              allow_new: true,
            },
          ],
        },
      ],
    });
    assert.equal(queries.length, 3);
    assert.equal(queries.filter((q) => q.slot === 'bottom').length, 2);
    assert.ok(queries.every((q) => q.outfitId && q.query && q.target));
  });
});

describe('collapseIdenticalSlotQueries', () => {
  it('2 outfit × 同 slot 同 query 合并为 1 次检索', () => {
    const collapsed = collapseIdenticalSlotQueries([
      { outfitId: 'outfit_1', slot: 'top', query: '法式针织 米白' },
      { outfitId: 'outfit_2', slot: 'top', query: '法式针织 米白' },
      { outfitId: 'outfit_1', slot: 'bottom', query: '法式直筒裤 藏青' },
      { outfitId: 'outfit_2', slot: 'bottom', query: '法式半裙 深棕' },
    ]);
    assert.equal(collapsed.length, 3);
    const sharedTop = collapsed.find((g) => g.slot === 'top');
    assert.deepEqual(sharedTop?.outfitIds.sort(), ['outfit_1', 'outfit_2']);
  });

  it('2 outfit × 4 不同槽不同 query → 8 次', () => {
    const queries = [];
    for (const outfitId of ['outfit_1', 'outfit_2']) {
      for (const slot of ['top', 'bottom', 'outerwear', 'shoes'] as const) {
        queries.push({
          outfitId,
          slot,
          query: `${outfitId}-${slot}-q`,
        });
      }
    }
    assert.equal(collapseIdenticalSlotQueries(queries).length, 8);
  });
});

describe('planQueryBottomCategoryConflict', () => {
  it('detects pants plan vs skirt new_item', () => {
    assert.equal(
      planQueryBottomCategoryConflict('法式九分高腰直筒裤 藏青', '深棕高腰A字半裙'),
      true
    );
    assert.equal(
      planQueryBottomCategoryConflict('法式九分高腰直筒裤 藏青', '米白高腰直筒九分裤'),
      false
    );
  });
});

describe('filterResultsByStyleSkill gate', () => {
  it('无 style-* 时不过滤', () => {
    const results = [
      item({
        id: 'fleece',
        subCategory: '摇粒绒半开襟套头衫',
        tags: ['户外', '运动'],
      }),
    ];
    assert.equal(filterResultsByStyleSkill(results, ['weather-dressing'], 'outerwear').length, 1);
  });

  it('style-french 滤掉户外摇粒绒', () => {
    const results = [
      item({
        id: 'fleece',
        subCategory: '摇粒绒半开襟套头衫',
        tags: ['户外', '运动'],
      }),
      item({
        id: 'trench',
        subCategory: '薄风衣',
        tags: ['通勤'],
        mainCategory: 'OUTERWEAR',
      }),
    ];
    const filtered = filterResultsByStyleSkill(results, ['style-french'], 'outerwear');
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].id, 'trench');
  });
});
