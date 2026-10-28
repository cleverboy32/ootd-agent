import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { filterResultsByQueryCategory } from '@/server/utils/queryCategoryFilter';
import type { WardrobeSearchResult } from '@/server/services/wardrobeService';

function item(
  partial: Partial<WardrobeSearchResult> & Pick<WardrobeSearchResult, 'id' | 'subCategory'>
): WardrobeSearchResult {
  return {
    imageUrl: 'https://example.com/x.jpg',
    mainCategory: 'FOOTWEAR',
    description: '',
    colors: ['米色'],
    season: ['spring', 'autumn'],
    tags: [],
    material: [],
    similarity: 0.7,
    ...partial,
  };
}

describe('filterResultsByQueryCategory', () => {
  it('玛丽珍 query 滤掉运动鞋；滤空不回退', () => {
    const results = [
      item({
        id: '1',
        subCategory: '复古运动鞋',
        mainCategory: 'FOOTWEAR',
        description: '米色麂皮鞋面拼接网眼布，配白色珍珠装饰鞋带和棕色生胶感鞋底。',
      }),
      item({ id: '2', subCategory: '户外徒步鞋', mainCategory: 'FOOTWEAR' }),
    ];
    const filtered = filterResultsByQueryCategory(results, '玛丽珍鞋 米色', 'shoes');
    assert.equal(filtered.length, 0);
  });

  it('麂皮鞋面不会被误判为皮鞋而放过运动鞋', () => {
    const results = [
      item({
        id: '1',
        subCategory: '复古运动鞋',
        description: '米色麂皮鞋面，棕色生胶底',
      }),
    ];
    assert.equal(filterResultsByQueryCategory(results, '米色平底单鞋', 'shoes').length, 0);
  });

  it('乐福鞋 query 保留乐福、去掉运动鞋', () => {
    const results = [
      item({ id: '1', subCategory: '复古运动鞋', mainCategory: 'FOOTWEAR' }),
      item({
        id: '2',
        subCategory: '乐福鞋',
        mainCategory: 'FOOTWEAR',
        description: '深棕乐福',
      }),
    ];
    const filtered = filterResultsByQueryCategory(results, '深棕乐福鞋', 'shoes');
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.id, '2');
  });

  it('薄针织开衫 query 滤掉棉服和连帽开衫', () => {
    const results = [
      item({
        id: '1',
        subCategory: '针织连帽开衫',
        mainCategory: 'OUTERWEAR',
        description: '浅米灰横条纹连帽拉链开衫',
      }),
      item({
        id: '2',
        subCategory: '立领棉服',
        mainCategory: 'OUTERWEAR',
        description: '薄棉服',
      }),
      item({
        id: '3',
        subCategory: '针织开衫',
        mainCategory: 'OUTERWEAR',
        description: '燕麦色薄针织开衫无帽',
      }),
    ];
    const filtered = filterResultsByQueryCategory(results, '薄针织开衫 燕麦色', 'outerwear');
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.id, '3');
  });

  it('长裤 query 滤掉半身裙', () => {
    const results = [
      item({ id: '1', subCategory: '阔腿长裤', mainCategory: 'BOTTOM' }),
      item({
        id: '2',
        subCategory: '格纹不规则半身裙',
        mainCategory: 'BOTTOM',
        description: '黑白细格纹半身裙',
      }),
    ];
    const filtered = filterResultsByQueryCategory(results, '高腰直筒长裤', 'bottom');
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.id, '1');
  });

  it('query 过粗时不过滤', () => {
    const results = [item({ id: '1', subCategory: '复古运动鞋', mainCategory: 'FOOTWEAR' })];
    assert.equal(filterResultsByQueryCategory(results, '鞋', 'shoes').length, 1);
  });
});
