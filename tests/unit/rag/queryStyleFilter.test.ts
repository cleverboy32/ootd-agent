import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  filterResultsByStyleSkill,
  getActiveStyleSkillName,
} from '@/server/utils/queryStyleFilter';
import type { WardrobeSearchResult } from '@/server/services/wardrobeService';

function item(
  partial: Partial<WardrobeSearchResult> & Pick<WardrobeSearchResult, 'id' | 'subCategory'>
): WardrobeSearchResult {
  return {
    imageUrl: 'https://example.com/x.jpg',
    mainCategory: 'OUTERWEAR',
    description: '',
    colors: ['浅米灰'],
    season: ['spring', 'autumn', 'winter'],
    tags: [],
    material: [],
    similarity: 0.7,
    ...partial,
  };
}

describe('getActiveStyleSkillName', () => {
  it('returns first style-* skill', () => {
    assert.equal(
      getActiveStyleSkillName(['weather-dressing', 'style-sweet', 'body-petite']),
      'style-sweet'
    );
  });
});

describe('filterResultsByStyleSkill', () => {
  it('甜美：滤掉连帽开衫与运动/街头 tags，保留无冲突开衫', () => {
    const results = [
      item({
        id: 'hood',
        subCategory: '针织连帽开衫',
        tags: ['复古', '休闲', '叠穿', '日常'],
        description: '浅米灰横条纹连帽拉链开衫',
      }),
      item({
        id: 'sport',
        subCategory: '摇粒绒半开襟套头衫',
        tags: ['休闲', '户外', '保暖', '叠穿', '运动'],
      }),
      item({
        id: 'ok',
        subCategory: '针织开衫',
        tags: ['通勤', '叠穿', '日常'],
        description: '燕麦色薄针织开衫无帽',
      }),
    ];
    const filtered = filterResultsByStyleSkill(
      results,
      ['style-sweet', 'weather-dressing'],
      'outerwear'
    );
    assert.deepEqual(
      filtered.map((x) => x.id),
      ['ok']
    );
  });

  it('无 style 技能时不过滤', () => {
    const results = [
      item({
        id: 'hood',
        subCategory: '针织连帽开衫',
        tags: ['休闲'],
      }),
    ];
    assert.equal(filterResultsByStyleSkill(results, ['weather-dressing'], 'outerwear').length, 1);
  });

  it('不因「休闲」单独过滤（库内过于常见）', () => {
    const results = [
      item({
        id: 'cardigan',
        subCategory: '针织开衫',
        tags: ['休闲', '通勤'],
        description: '圆领薄开衫',
      }),
    ];
    assert.equal(
      filterResultsByStyleSkill(results, ['style-sweet'], 'outerwear').length,
      1
    );
  });
});
