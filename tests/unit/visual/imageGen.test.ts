import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildImagePrompt, buildOutfitReferenceInputs } from '@/server/agents/visual/imageGen';
import type { StylistOutfit } from '@/server/agents/stylist';

const outfit: StylistOutfit = {
  id: 'outfit_1',
  overall_concept: '周末出街',
  selected_items: [
    { id: 'item-top', name: 'White Linen Shirt', layer: 'top', reason: 'light top' },
    { id: 'item-bottom', name: 'Gray Wide-leg Trousers', layer: 'bottom', reason: 'comfortable bottom' },
  ],
  visual_composition: {
    model_pose: 'standing casually',
    outfit_details: 'relaxed summer look',
    background: 'city street',
  },
};

describe('buildOutfitReferenceInputs', () => {
  it('maps wardrobe urls to reference labels in order', () => {
    const { referenceUrls, referenceLabels } = buildOutfitReferenceInputs(
      outfit,
      ['https://example.com/top.jpg', 'https://example.com/bottom.jpg'],
      undefined,
      new Map([
        [
          'item-top',
          {
            id: 'item-top',
            imageUrl: 'https://example.com/top.jpg',
            mainCategory: 'TOP',
            subCategory: 'Linen Shirt',
            colors: ['white'],
            silhouette: ['relaxed'],
            description: 'A white linen shirt.',
          } as never,
        ],
      ])
    );

    assert.deepEqual(referenceUrls, [
      'https://example.com/top.jpg',
      'https://example.com/bottom.jpg',
    ]);
    assert.match(referenceLabels[0], /White Linen Shirt/);
    assert.match(referenceLabels[0], /colors: white/);
  });

  it('prepends anchor garment as 图1 when anchor image data exists', () => {
    const { referenceUrls, referenceLabels } = buildOutfitReferenceInputs(
      outfit,
      ['https://example.com/top.jpg'],
      { data: 'abc123', mimeType: 'image/jpeg' }
    );

    assert.equal(referenceUrls[0], 'data:image/jpeg;base64,abc123');
    assert.match(referenceLabels[0], /anchor garment/);
  });
});

describe('buildImagePrompt with Seedream references', () => {
  it('includes 图N labels when reference labels are provided', () => {
    const prompt = buildImagePrompt(outfit, undefined, [
      'White Linen Shirt (top)',
      'Gray Wide-leg Trousers (bottom)',
    ]);

    assert.match(prompt, /图1: White Linen Shirt/);
    assert.match(prompt, /图2: Gray Wide-leg Trousers/);
    assert.match(prompt, /图1 through 图2/);
  });
});
