import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ClothingItem } from '@prisma/client';
import type { StylistCacheNode } from '@/server/utils/messageContent';
import { buildSavedOutfitFromCache } from '@/server/utils/savedOutfitSnapshot';

function wardrobeItem(partial: Pick<ClothingItem, 'id' | 'imageUrl'>): ClothingItem {
  return {
    id: partial.id,
    imageUrl: partial.imageUrl,
    mainCategory: 'TOP',
    subCategory: 'T-shirt',
    season: [],
    material: [],
    description: null,
    colors: [],
    tags: [],
    searchDescription: null,
    occasions: [],
    formality: null,
    silhouette: [],
    clientProfileId: 'client-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as ClothingItem;
}

const cache: StylistCacheNode = {
  type: 'stylist_cache',
  stylist_result: {
    outfits: [
      {
        id: 'outfit_1',
        overall_concept: '通勤干练',
        selected_items: [
          { id: 'w1', name: '白衬衫', layer: 'inner_top', reason: '干净' },
          { id: 'new_item', name: '黑西裤', layer: 'bottom', reason: '挺括' },
        ],
        visual_composition: {
          model_pose: 'standing',
          outfit_details: 'white shirt',
          background: 'office',
        },
      },
    ],
  },
  user_profile: {} as StylistCacheNode['user_profile'],
  wardrobe_items: [wardrobeItem({ id: 'w1', imageUrl: 'https://cdn.example/w1.jpg' })],
};

describe('buildSavedOutfitFromCache', () => {
  it('builds title, cover from imageStates, and wardrobe snapshot', () => {
    const built = buildSavedOutfitFromCache(cache, 'outfit_1', {
      outfit_1: 'https://cdn.example/cover.jpg',
    });
    assert.ok(built);
    assert.equal(built.title, '通勤干练');
    assert.equal(built.coverImageUrl, 'https://cdn.example/cover.jpg');
    assert.equal(built.snapshot.items.length, 2);
    assert.equal(built.snapshot.items[0].wardrobeItemId, 'w1');
    assert.equal(built.snapshot.items[0].imageUrl, 'https://cdn.example/w1.jpg');
    assert.equal(built.snapshot.items[1].wardrobeItemId, undefined);
  });

  it('falls back to first item image when effect image missing', () => {
    const built = buildSavedOutfitFromCache(cache, 'outfit_1', {});
    assert.ok(built);
    assert.equal(built.coverImageUrl, 'https://cdn.example/w1.jpg');
  });

  it('returns null for unknown outfit id', () => {
    assert.equal(buildSavedOutfitFromCache(cache, 'outfit_9', {}), null);
  });
});
