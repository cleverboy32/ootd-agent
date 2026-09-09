import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildStylistSelectionAudit,
  layerToSearchSlot,
} from '@/server/utils/stylistSelectionAudit';
import type { StylistResult } from '@/server/agents/stylist/schema';

describe('layerToSearchSlot', () => {
  it('maps stylist layers to RAG slots', () => {
    assert.equal(layerToSearchSlot('inner_top'), 'top');
    assert.equal(layerToSearchSlot('bottom'), 'bottom');
    assert.equal(layerToSearchSlot('shoes'), 'shoes');
  });
});

describe('buildStylistSelectionAudit', () => {
  const result: StylistResult = {
    outfits: [
      {
        id: 'outfit_1',
        overall_concept: 'test',
        selected_items: [
          {
            id: 'id_b',
            name: 'Jeans',
            layer: 'bottom',
            reason: '配色合适',
          },
          {
            id: 'new_item',
            name: 'Sneakers',
            layer: 'shoes',
            reason: '衣橱无合适运动鞋',
          },
          {
            id: 'anchor_id',
            name: 'Shirt',
            layer: 'inner_top',
            reason: '衣橱锚点',
          },
        ],
        visual_composition: {
          model_pose: 'standing',
          outfit_details: 'details',
          background: 'studio',
        },
      },
    ],
  };

  it('records rank among candidates and new_item / off-list picks', () => {
    const entry = buildStylistSelectionAudit({
      result,
      requestType: 'wardrobe_pairing',
      slotSnapshots: [
        {
          slot: 'bottom',
          matchStatus: 'adequate',
          bestSimilarity: 0.8,
          candidates: [
            { id: 'id_a', subCategory: 'Cargo Pants', similarity: 0.8 },
            { id: 'id_b', subCategory: 'Jeans', similarity: 0.7 },
            { id: 'id_c', subCategory: 'Shorts', similarity: 0.6 },
          ],
        },
        {
          slot: 'shoes',
          matchStatus: 'weak',
          bestSimilarity: 0.45,
          candidates: [{ id: 'shoe_1', subCategory: 'Loafers', similarity: 0.45 }],
        },
      ],
    });

    const bottom = entry.outfits[0].slots.find((s) => s.slot === 'bottom');
    assert.ok(bottom);
    assert.equal(bottom.selected[0].id, 'id_b');
    assert.equal(bottom.selected[0].rankAmongCandidates, 2);
    assert.equal(bottom.selected[0].inTop1, false);
    assert.equal(bottom.selected[0].inTop3, true);

    const shoes = entry.outfits[0].slots.find((s) => s.slot === 'shoes');
    assert.ok(shoes);
    assert.equal(shoes.usedNewItemDespiteCandidates, true);
    assert.equal(shoes.selected[0].isNewItem, true);

    assert.deepEqual(entry.outfits[0].offListWardrobeIds, ['anchor_id']);
    assert.equal(entry.summary.wardrobePickCount, 1);
    assert.equal(entry.summary.newItemCount, 1);
    assert.equal(entry.summary.inTop1Count, 0);
    assert.equal(entry.summary.inTop3Count, 1);
    assert.equal(entry.summary.offListCount, 1);
    assert.equal(entry.summary.weakOrNoneHardPickCount, 0);
  });

  it('counts weak-slot hard picks', () => {
    const entry = buildStylistSelectionAudit({
      result: {
        outfits: [
          {
            id: 'outfit_1',
            overall_concept: 'x',
            selected_items: [
              { id: 'shoe_1', name: 'Loafers', layer: 'shoes', reason: '硬选' },
            ],
            visual_composition: {
              model_pose: '',
              outfit_details: '',
              background: '',
            },
          },
        ],
      },
      slotSnapshots: [
        {
          slot: 'shoes',
          matchStatus: 'weak',
          bestSimilarity: 0.4,
          candidates: [{ id: 'shoe_1', subCategory: 'Loafers', similarity: 0.4 }],
        },
      ],
    });

    assert.equal(entry.summary.weakOrNoneHardPickCount, 1);
    assert.equal(entry.summary.inTop1Count, 1);
  });
});
