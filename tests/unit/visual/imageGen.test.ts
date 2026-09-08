import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ACCESSORY_SCALE_HINT,
  buildImagePrompt,
  buildOutfitReferenceInputs,
} from '@/server/agents/visual/imageGen';
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

const outfitWithAccessory: StylistOutfit = {
  ...outfit,
  selected_items: [
    ...outfit.selected_items,
    {
      id: 'item-acc',
      name: 'Pendant Necklace',
      layer: 'accessory',
      reason: 'accent',
    },
  ],
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
    const purchaseOutfit: StylistOutfit = {
      ...outfit,
      selected_items: [
        { id: 'item-top', name: 'White Linen Shirt', layer: 'top', reason: 'light top' },
        {
          id: 'new_item',
          name: '深灰色高腰阔腿裤',
          layer: 'bottom',
          reason: 'purchase anchor',
        },
      ],
    };
    const { referenceUrls, referenceLabels } = buildOutfitReferenceInputs(
      purchaseOutfit,
      ['https://example.com/top.jpg'],
      { data: 'abc123', mimeType: 'image/jpeg' }
    );

    assert.equal(referenceUrls[0], 'data:image/jpeg;base64,abc123');
    assert.match(referenceLabels[0], /深灰色高腰阔腿裤/);
    assert.match(referenceLabels[0], /bottom/);
    assert.match(referenceLabels[0], /anchor garment/);
  });

  it('prefers anchor_image_url over base64 for Seedream refs', () => {
    const purchaseOutfit: StylistOutfit = {
      ...outfit,
      selected_items: [
        {
          id: 'new_item',
          name: '深灰色高腰阔腿裤',
          layer: 'bottom',
          reason: 'purchase anchor',
        },
      ],
    };
    const { referenceUrls } = buildOutfitReferenceInputs(
      purchaseOutfit,
      ['https://example.com/top.jpg'],
      { data: 'abc123', mimeType: 'image/jpeg' },
      undefined,
      'https://cdn.example/pants.jpg'
    );
    assert.equal(referenceUrls[0], 'https://cdn.example/pants.jpg');
    assert.equal(referenceUrls[1], 'https://example.com/top.jpg');
  });

  it('inserts additional purchase refs after primary anchor', () => {
    const dualNew: StylistOutfit = {
      ...outfit,
      selected_items: [
        { id: 'new_item', name: '黑色短款机车皮衣', layer: 'outerwear', reason: 'a' },
        { id: 'new_item', name: '深灰色高腰阔腿裤', layer: 'bottom', reason: 'b' },
        { id: 'item-top', name: 'Tee', layer: 'top', reason: 'c' },
      ],
    };
    const { referenceUrls, referenceLabels } = buildOutfitReferenceInputs(
      dualNew,
      ['https://example.com/tee.jpg'],
      undefined,
      undefined,
      'https://cdn.example/jacket.jpg',
      [{ url: 'https://cdn.example/pants.jpg', label: '深灰色高腰阔腿裤 (bottom) — session si_1' }]
    );
    assert.deepEqual(referenceUrls, [
      'https://cdn.example/jacket.jpg',
      'https://cdn.example/pants.jpg',
      'https://example.com/tee.jpg',
    ]);
    assert.match(referenceLabels[1], /si_1/);
  });

  it('annotates accessory references with realistic scale hint', () => {
    const { referenceLabels } = buildOutfitReferenceInputs(
      outfitWithAccessory,
      [
        'https://example.com/top.jpg',
        'https://example.com/bottom.jpg',
        'https://example.com/necklace.jpg',
      ],
      undefined,
      new Map([
        [
          'item-acc',
          {
            id: 'item-acc',
            mainCategory: 'ACCESSORY',
            subCategory: 'Pendant Necklace',
            colors: ['silver'],
            description: 'A silver pendant necklace.',
          } as never,
        ],
      ])
    );

    assert.match(referenceLabels[2], new RegExp(ACCESSORY_SCALE_HINT));
    assert.doesNotMatch(referenceLabels[0], /realistic on-body scale/);
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

  it('adds accessory scale critical when outfit includes accessory', () => {
    const prompt = buildImagePrompt(outfitWithAccessory);
    assert.match(prompt, /CRITICAL ACCESSORY SCALE/);
    assert.match(prompt, /product close-ups/i);
  });

  it('omits accessory scale critical when no accessory', () => {
    const prompt = buildImagePrompt(outfit);
    assert.doesNotMatch(prompt, /CRITICAL ACCESSORY SCALE/);
  });
});
