import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildNewItemDiversityBlock,
  collectRecentNewItemLabels,
} from '@/server/agents/stylist/newItemDiversity';

describe('collectRecentNewItemLabels', () => {
  it('collects new_item labels and skips wardrobe ids', () => {
    const labels = collectRecentNewItemLabels(
      [
        {
          selected_items: [
            { id: 'cmth123', name: '米白阔腿裤', layer: 'bottom', reason: '' },
            {
              id: 'new_item',
              name: '藏青色短款风衣',
              layer: 'outerwear',
              reason: '',
            },
            {
              id: 'new_item',
              name: '浅粉色泡泡袖针织衫',
              layer: 'inner_top',
              reason: '',
            },
          ],
        },
      ],
      [
        {
          outfits: [
            {
              id: 'outfit_1',
              overall_concept: '',
              selected_items: [
                {
                  id: 'new_item',
                  name: '藏青色短款风衣',
                  layer: 'outerwear',
                  reason: '',
                },
              ],
              visual_composition: {
                model_pose: '',
                outfit_details: '',
                background: '',
              },
            },
          ],
        },
      ]
    );

    assert.deepEqual(labels, [
      'outerwear: 藏青色短款风衣',
      'inner_top: 浅粉色泡泡袖针织衫',
    ]);
  });
});

describe('buildNewItemDiversityBlock', () => {
  it('emits block for outfit_redo when labels exist', () => {
    const block = buildNewItemDiversityBlock('outfit_redo', [
      'outerwear: 藏青色短款风衣',
    ]);
    assert.match(block, /新品多样性/);
    assert.match(block, /藏青短风衣|藏青色短款风衣/);
    assert.match(block, /禁止/);
  });

  it('skips empty labels and non-regen types', () => {
    assert.equal(buildNewItemDiversityBlock('outfit_redo', []), '');
    assert.equal(
      buildNewItemDiversityBlock('clarify', ['outerwear: 藏青色短款风衣']),
      ''
    );
  });
});
