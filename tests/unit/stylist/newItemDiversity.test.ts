import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildNewItemDiversityBlock,
  collectRecentNewItemLabels,
  collectRecentOutfitFingerprints,
  collectRecentWardrobeIds,
  fingerprintOutfit,
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

describe('fingerprintOutfit', () => {
  it('reads 形制= branch from concept', () => {
    const fp = fingerprintOutfit({
      overall_concept: '形制=长身交领袍，江湖赶路气',
      selected_items: [
        { id: 'new_item', name: '玄黑长身交领袍', layer: 'outerwear', reason: '' },
      ],
    });
    assert.match(fp, /branch:长身交领袍/);
    assert.match(fp, /sil:/);
  });

  it('falls back to silhouette tokens without branch tag', () => {
    const fp = fingerprintOutfit({
      overall_concept: '利落短打劲装',
      selected_items: [
        { id: 'new_item', name: '藏青短打', layer: 'outerwear', reason: '' },
      ],
    });
    assert.match(fp, /短打/);
  });
});

describe('collectRecentOutfitFingerprints / wardrobe ids', () => {
  it('collects fingerprints and wardrobe ids', () => {
    const outfits = [
      {
        overall_concept: '形制=短打劲装',
        selected_items: [
          { id: 'wardrobe-shirt-1', name: '针织翻领衬衫', layer: 'inner_top', reason: '' },
          { id: 'new_item', name: '玄黑短打', layer: 'outerwear', reason: '' },
        ],
      },
    ];
    const fps = collectRecentOutfitFingerprints(outfits, null);
    assert.equal(fps.length, 1);
    assert.match(fps[0]!, /branch:短打劲装/);

    const ids = collectRecentWardrobeIds(outfits, null);
    assert.deepEqual(ids, ['wardrobe-shirt-1']);
  });
});

describe('buildNewItemDiversityBlock', () => {
  it('emits fingerprint and new_item guidance for outfit_redo', () => {
    const block = buildNewItemDiversityBlock(
      'outfit_redo',
      ['outerwear: 藏青色短款风衣'],
      { fingerprints: ['branch:短打劲装|col:藏青'], wardrobeIds: ['id-1'] }
    );
    assert.match(block, /方案多样性/);
    assert.match(block, /短打劲装/);
    assert.match(block, /藏青短风衣|藏青色短款风衣/);
    assert.match(block, /id-1/);
    assert.match(block, /换关键槽品类轮廓|形制=/);
  });

  it('emits for wardrobe_outfit when prior fingerprints exist', () => {
    const block = buildNewItemDiversityBlock('wardrobe_outfit', [], {
      fingerprints: ['sil:乐福+直筒|col:米'],
    });
    assert.match(block, /方案多样性/);
    assert.match(block, /乐福/);
  });

  it('skips empty labels and non-regen types', () => {
    assert.equal(buildNewItemDiversityBlock('outfit_redo', []), '');
    assert.equal(buildNewItemDiversityBlock('wardrobe_outfit', []), '');
    assert.equal(
      buildNewItemDiversityBlock('clarify', ['outerwear: 藏青色短款风衣']),
      ''
    );
    assert.equal(
      buildNewItemDiversityBlock('feedback_revision', [], {
        fingerprints: ['sil:乐福'],
      }),
      ''
    );
  });
});
