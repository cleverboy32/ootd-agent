import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ClothingItem } from '@prisma/client';
import { useWardrobeItemsStore } from '@/store/wardrobe-items-store';

function item(partial: Pick<ClothingItem, 'id' | 'subCategory'> & Partial<ClothingItem>): ClothingItem {
  return {
    imageUrl: 'https://example.com/x.jpg',
    mainCategory: 'TOP',
    season: [],
    material: [],
    tempMin: null,
    tempMax: null,
    description: null,
    colors: [],
    tags: [],
    searchDescription: null,
    occasions: [],
    formality: null,
    silhouette: [],
    status: 'completed',
    userId: 'u1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...partial,
  } as ClothingItem;
}

describe('wardrobe-items-store local mutations', () => {
  it('upsert 新增到列表头，同 id 则合并', () => {
    useWardrobeItemsStore.getState().reset();
    const a = item({ id: 'a', subCategory: '衬衫' });
    const b = item({ id: 'b', subCategory: '外套' });
    useWardrobeItemsStore.getState().upsert(a);
    useWardrobeItemsStore.getState().upsert(b);
    assert.deepEqual(
      useWardrobeItemsStore.getState().items.map((entry) => entry.id),
      ['b', 'a']
    );

    useWardrobeItemsStore.getState().upsert(item({ id: 'a', subCategory: '针织衫', colors: ['白'] }));
    const updated = useWardrobeItemsStore.getState().items.find((entry) => entry.id === 'a');
    assert.equal(updated?.subCategory, '针织衫');
    assert.deepEqual(updated?.colors, ['白']);
  });

  it('removeIds 去掉指定单品', () => {
    useWardrobeItemsStore.getState().reset();
    useWardrobeItemsStore.getState().upsert(item({ id: 'a', subCategory: '衬衫' }));
    useWardrobeItemsStore.getState().upsert(item({ id: 'b', subCategory: '外套' }));
    useWardrobeItemsStore.getState().removeIds(['a']);
    assert.deepEqual(
      useWardrobeItemsStore.getState().items.map((entry) => entry.id),
      ['b']
    );
  });
});
