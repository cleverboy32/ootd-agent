import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  alignOutfitPlanTempsToSlotRanges,
  alignSearchQueryTempToSlotRange,
  clampNoStyleOutfitPlan,
  expandNoStyleCoverageSlots,
  flattenOutfitPlanToQueries,
  planQueryBottomCategoryConflict,
} from '@/server/utils/outfitPlanSearch';
import { THICKNESS_TEMP_RANGES } from '@/server/utils/slotTempFilter';
import {
  collapseIdenticalSlotQueries,
  collapseQueriesForRound,
} from '@/server/utils/ragSearchSlots';
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

describe('alignSearchQueryTempToSlotRange', () => {
  it('rewrites 16-24 thin base phrase to thermal_base when slot is cold inner', () => {
    const out = alignSearchQueryTempToSlotRange(
      '薄长袖打底衫，适合16到24度单穿，作为内搭贴身层，休闲风格。',
      THICKNESS_TEMP_RANGES.thermal_base
    );
    assert.match(out, /适合-15到4度单穿/);
    assert.doesNotMatch(out, /16到24/);
  });

  it('keeps phrase when already overlapping slot range', () => {
    const out = alignSearchQueryTempToSlotRange(
      '薄长袖打底，适合16到23度单穿。',
      THICKNESS_TEMP_RANGES.thin_top_long
    );
    assert.match(out, /16到23/);
  });
});

describe('alignOutfitPlanTempsToSlotRanges', () => {
  it('at 5℃ rewrites inner_top query off thin-base temps', () => {
    const aligned = alignOutfitPlanTempsToSlotRanges(
      {
        outfits: [
          {
            id: 'outfit_1',
            overall_concept: '冷天',
            slots: [
              {
                slot: 'inner_top',
                target: '薄打底 16-24',
                search_query:
                  '薄长袖打底衫，适合16到24度单穿，作为内搭贴身层，休闲风格，日常出行。',
                allow_new: true,
              },
            ],
          },
        ],
      },
      '约5℃'
    );
    const q = aligned.outfits[0].slots[0].search_query;
    assert.match(q, /适合-15到4度单穿/);
    assert.doesNotMatch(q, /16到24/);
  });
});

describe('expandNoStyleCoverageSlots', () => {
  it('at 15℃ adds skirt + legwear when plan only has bottom', () => {
    const expanded = expandNoStyleCoverageSlots(
      {
        outfits: [
          {
            id: 'outfit_1',
            overall_concept: '通勤',
            slots: [
              {
                slot: 'bottom',
                target: '牛仔裤',
                search_query: '直筒牛仔裤，适合12到23度单穿。',
                allow_new: true,
              },
            ],
          },
        ],
      },
      '约15℃'
    );
    const slots = expanded.outfits[0].slots.map((s) => s.slot);
    assert.ok(slots.includes('bottom'));
    assert.ok(slots.includes('skirt'));
    assert.ok(slots.includes('legwear'));
  });

  it('does not add legwear on hot band', () => {
    const expanded = expandNoStyleCoverageSlots(
      {
        outfits: [
          {
            id: 'outfit_1',
            overall_concept: '炎热',
            slots: [
              {
                slot: 'bottom',
                target: '短裤',
                search_query: '短裤，适合24到38度单穿。',
                allow_new: true,
              },
            ],
          },
        ],
      },
      '约32℃'
    );
    const slots = expanded.outfits[0].slots.map((s) => s.slot);
    assert.ok(slots.includes('skirt'));
    assert.ok(!slots.includes('legwear'));
  });
});

describe('clampNoStyleOutfitPlan', () => {
  it('keeps only outfit_1 when plan has multiple outfits', () => {
    const clamped = clampNoStyleOutfitPlan({
      outfits: [
        {
          id: 'outfit_1',
          overall_concept: '骨架A',
          slots: [
            { slot: 'bottom', target: '裤', search_query: '厚裤', allow_new: true },
          ],
        },
        {
          id: 'outfit_2',
          overall_concept: '骨架B',
          slots: [
            { slot: 'bottom', target: '裙', search_query: '厚裙', allow_new: true },
          ],
        },
      ],
    });
    assert.equal(clamped.outfits.length, 1);
    assert.equal(clamped.outfits[0].id, 'outfit_1');
    assert.equal(clamped.outfits[0].overall_concept, '骨架A');
  });
});

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

describe('collapseQueriesForRound', () => {
  it('keeps paired and unpaired outer pants in separate searches even for identical queries', () => {
    const queries = [
      { outfitId: 'outfit_1', slot: 'bottom', query: '全长通勤裤' },
      { outfitId: 'outfit_2', slot: 'bottom', query: '全长通勤裤' },
    ] as const;
    for (const sharedPoolBySlot of [true, false]) {
      const groups = collapseQueriesForRound([...queries], {
        sharedPoolBySlot,
        filterKey: (query) => query.outfitId === 'outfit_1' ? 'layered_bottom' : '',
      });
      assert.deepEqual(groups.map(({ outfitIds }) => outfitIds), [['outfit_1'], ['outfit_2']]);
    }
  });

  it('无 style sharedPoolBySlot：同槽不同 query 仍合并为 1，canonical 取 outfit_1', () => {
    const collapsed = collapseQueriesForRound(
      [
        { outfitId: 'outfit_2', slot: 'bottom', query: '半裙 query', target: '半裙' },
        { outfitId: 'outfit_1', slot: 'bottom', query: '直筒裤 query', target: '直筒裤' },
        { outfitId: 'outfit_1', slot: 'shoes', query: '皮鞋' },
        { outfitId: 'outfit_2', slot: 'shoes', query: '运动鞋' },
      ],
      { sharedPoolBySlot: true }
    );
    assert.equal(collapsed.length, 2);
    const bottom = collapsed.find((g) => g.slot === 'bottom');
    assert.equal(bottom?.query, '直筒裤 query');
    assert.equal(bottom?.target, '直筒裤');
    assert.deepEqual(bottom?.outfitIds.sort(), ['outfit_1', 'outfit_2']);
    const shoes = collapsed.find((g) => g.slot === 'shoes');
    assert.equal(shoes?.query, '皮鞋');
    assert.deepEqual(shoes?.outfitIds.sort(), ['outfit_1', 'outfit_2']);
  });

  it('有 style：同槽不同 query 仍各搜一次', () => {
    const collapsed = collapseQueriesForRound(
      [
        { outfitId: 'outfit_1', slot: 'bottom', query: '直筒裤' },
        { outfitId: 'outfit_2', slot: 'bottom', query: '半裙' },
      ],
      { sharedPoolBySlot: false }
    );
    assert.equal(collapsed.length, 2);
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
