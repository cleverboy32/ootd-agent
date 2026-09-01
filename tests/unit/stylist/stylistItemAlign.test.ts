import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  filterQueriesForRevisionSlots,
  inferRevisionSearchSlots,
} from '@/server/utils/revisionSearchSlots';
import {
  alignStylistItemsWithWardrobe,
  reconcileAccessoryOutfitDetails,
} from '@/server/utils/stylistItemAlign';
import type { StylistResult } from '@/server/agents/stylist/schema';

describe('inferRevisionSearchSlots', () => {
  it('infers accessory for necklace / choker swap', () => {
    assert.deepEqual(
      inferRevisionSearchSlots('在第二套基础上，把配饰项链/choker换成其他款式'),
      ['accessory']
    );
  });

  it('infers shoes for shoe swap', () => {
    assert.deepEqual(inferRevisionSearchSlots('鞋换成白色运动鞋'), ['shoes']);
  });

  it('returns empty when no slot hints', () => {
    assert.deepEqual(inferRevisionSearchSlots('整体再正式一点'), []);
  });
});

describe('filterQueriesForRevisionSlots', () => {
  it('keeps only accessory queries when swapping necklace', () => {
    const filtered = filterQueriesForRevisionSlots(
      [
        { slot: 'top', query: 'gray tee' },
        { slot: 'accessory', query: 'silver necklace minimalist' },
        { slot: 'shoes', query: 'beige sneakers' },
      ],
      '把项链换成其他配饰'
    );
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].slot, 'accessory');
  });

  it('passes through all queries when slots cannot be inferred', () => {
    const queries = [
      { slot: 'top' as const, query: 'tee' },
      { slot: 'bottom' as const, query: 'pants' },
    ];
    assert.deepEqual(filterQueriesForRevisionSlots(queries, '更有高级感'), queries);
  });
});

describe('alignStylistItemsWithWardrobe', () => {
  it('overwrites Necklace name when wardrobe item is Earrings', () => {
    const result: StylistResult = {
      outfits: [
        {
          id: 'outfit_2',
          overall_concept: '10%银色项链点缀，清冷利落',
          selected_items: [
            {
              id: 'earring-1',
              name: 'Geometric Silver Necklace',
              layer: 'accessory',
              reason: '换成银色几何项链',
            },
          ],
          visual_composition: {
            model_pose: 'walking',
            outfit_details:
              'Wearing a gray tee and cream trousers, finished with a sleek silver geometric pendant necklace resting at the collarbone.',
            background: 'cafe terrace',
          },
        },
      ],
    };

    const cache = new Map([
      [
        'earring-1',
        {
          subCategory: 'Geometric Drop Earrings',
          description:
            'A pair of silver-tone geometric drop earrings featuring abstract polygonal shapes.',
          mainCategory: 'ACCESSORY' as const,
        },
      ],
    ]);

    alignStylistItemsWithWardrobe(result, cache);

    const item = result.outfits[0].selected_items[0];
    assert.equal(item.name, 'Geometric Drop Earrings');
    assert.match(result.outfits[0].overall_concept, /耳环|Geometric Drop Earrings/);
    assert.doesNotMatch(result.outfits[0].overall_concept, /项链/);
    assert.match(result.outfits[0].visual_composition.outfit_details, /earrings/i);
    assert.doesNotMatch(
      result.outfits[0].visual_composition.outfit_details,
      /pendant necklace resting at the collarbone/i
    );
  });
});

describe('reconcileAccessoryOutfitDetails', () => {
  it('rewrites necklace clause when item is earrings', () => {
    const rewritten = reconcileAccessoryOutfitDetails(
      'Wearing a cream windbreaker, finished with a sleek silver geometric pendant necklace resting at the collarbone.',
      {
        subCategory: 'Geometric Drop Earrings',
        description: 'A pair of silver-tone geometric drop earrings.',
      }
    );
    assert.match(rewritten, /earrings/i);
    assert.doesNotMatch(rewritten, /necklace resting at the collarbone/i);
  });
});
