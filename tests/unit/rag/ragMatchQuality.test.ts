import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  assessSlotMatch,
  buildSlotMatchAssessments,
  isAthleticOccasion,
  isItemAthleticallyAppropriate,
  filterResultsForAthleticContext,
} from '@/server/utils/ragMatchQuality';
import type { WardrobeSearchResult } from '@/server/services/wardrobeService';
import { getEmbeddingSimilarityThresholds } from '@/server/services/embedding';

function item(
  partial: Partial<WardrobeSearchResult> & Pick<WardrobeSearchResult, 'id' | 'subCategory'>
): WardrobeSearchResult {
  return {
    imageUrl: 'https://example.com/x.jpg',
    mainCategory: 'BOTTOM',
    description: '',
    colors: ['gray'],
    season: ['summer'],
    tags: [],
    material: [],
    similarity: 0.7,
    ...partial,
  };
}

describe('isAthleticOccasion', () => {
  it('识别篮球/运动场合', () => {
    assert.equal(isAthleticOccasion({ occasion: '打篮球' } as never), true);
    assert.equal(isAthleticOccasion({ special_requests: '运动穿搭' } as never), true);
    assert.equal(isAthleticOccasion({ occasion: '日常通勤' } as never), false);
  });
});

describe('isItemAthleticallyAppropriate', () => {
  it('运动下装：Biker Shorts 可接受，Wrap Shorts 不可', () => {
    assert.equal(
      isItemAthleticallyAppropriate(
        item({ id: '1', subCategory: 'Biker Shorts', tags: ['athletic', 'sporty'] }),
        'bottom'
      ),
      true
    );
    assert.equal(
      isItemAthleticallyAppropriate(
        item({ id: '2', subCategory: 'Wrap Shorts', tags: ['casual'] }),
        'bottom'
      ),
      false
    );
  });

  it('运动鞋：徒步鞋在运动场景不可', () => {
    assert.equal(
      isItemAthleticallyAppropriate(
        item({ id: '3', subCategory: 'Hiking Sneakers', tags: ['outdoor'] }),
        'shoes'
      ),
      false
    );
  });
});

describe('assessSlotMatch (ByteDance/Doubao thresholds)', () => {
  // 默认测试环境未设置 EMBEDDING_PROVIDER=vertex 时，应使用 Doubao 阈值
  beforeEach(() => {
    delete process.env.EMBEDDING_PROVIDER;
    process.env.EMBEDDING_VENDOR = 'bytedance';
  });

  it('top1 低于 weak 阈值 → weak', () => {
    const assessment = assessSlotMatch([item({ id: 'a', subCategory: 'Wool Coat', similarity: 0.35 })], 'outerwear', false);
    assert.equal(assessment.status, 'weak');
    assert.match(assessment.note, /低于可用阈值/);
  });

  it('top1 高于 adequate 阈值 → adequate', () => {
    const assessment = assessSlotMatch([item({ id: 'b', subCategory: 'Blazer', similarity: 0.65 })], 'outerwear', false);
    assert.equal(assessment.status, 'adequate');
    assert.match(assessment.note, /有可用的衣橱单品/);
  });

  it('灰区分低且 gap 小 → weak', () => {
    const assessment = assessSlotMatch(
      [
        item({ id: 'c1', subCategory: 'Trench Coat', similarity: 0.58 }),
        item({ id: 'c2', subCategory: 'Puffer Jacket', similarity: 0.57 }),
      ],
      'outerwear',
      false
    );
    assert.equal(assessment.status, 'weak');
    assert.match(assessment.note, /胶着/);
  });

  it('灰区但 gap 足够大 → adequate', () => {
    const assessment = assessSlotMatch(
      [
        item({ id: 'd1', subCategory: 'Trench Coat', similarity: 0.58 }),
        item({ id: 'd2', subCategory: 'Puffer Jacket', similarity: 0.52 }),
      ],
      'outerwear',
      false
    );
    assert.equal(assessment.status, 'adequate');
    assert.match(assessment.note, /优先使用/);
  });

  it('运动场景下 Wrap Shorts 高分仍判 weak', () => {
    const assessment = assessSlotMatch(
      [
        item({
          id: 'w',
          subCategory: 'Wrap Shorts',
          similarity: 0.65,
          tags: ['casual'],
        }),
      ],
      'bottom',
      true
    );
    assert.equal(assessment.status, 'weak');
    assert.match(assessment.note, /不适配运动场合/);
  });

  it('运动场景 Activewear Top 高分判 adequate', () => {
    const assessment = assessSlotMatch(
      [
        item({
          id: 't',
          subCategory: 'Activewear Top',
          mainCategory: 'TOP',
          similarity: 0.65,
          tags: ['athletic', 'sporty'],
        }),
      ],
      'top',
      true
    );
    assert.equal(assessment.status, 'adequate');
  });
});

describe('assessSlotMatch (Vertex thresholds)', () => {
  it('使用 Vertex 阈值时 0.55 为 weak', () => {
    const originalProvider = process.env.EMBEDDING_PROVIDER;
    const originalVendor = process.env.EMBEDDING_VENDOR;
    process.env.EMBEDDING_PROVIDER = 'vertex';
    delete process.env.EMBEDDING_VENDOR;

    const assessment = assessSlotMatch([item({ id: 'v', subCategory: 'Blazer', similarity: 0.55 })], 'outerwear', false);
    assert.equal(assessment.status, 'weak');

    if (originalProvider !== undefined) process.env.EMBEDDING_PROVIDER = originalProvider;
    else delete process.env.EMBEDDING_PROVIDER;
    if (originalVendor !== undefined) process.env.EMBEDDING_VENDOR = originalVendor;
  });
});

describe('filterResultsForAthleticContext', () => {
  it('过滤时装短裤，保留运动短裤', () => {
    const results = [
      item({ id: 'w', subCategory: 'Wrap Shorts', similarity: 0.8 }),
      item({ id: 'b', subCategory: 'Biker Shorts', similarity: 0.66, tags: ['athletic'] }),
    ];
    const filtered = filterResultsForAthleticContext(results, 'bottom', true);
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].id, 'b');
  });
});

describe('buildSlotMatchAssessments', () => {
  it('生成多槽位评估', () => {
    const assessments = buildSlotMatchAssessments(
      [
        {
          slot: 'top',
          results: [
            item({
              id: 't',
              subCategory: 'Activewear Top',
              mainCategory: 'TOP',
              similarity: 0.65,
              tags: ['athletic'],
            }),
          ],
        },
        {
          slot: 'bottom',
          results: [
            item({ id: 'w', subCategory: 'Wrap Shorts', similarity: 0.65 }),
          ],
        },
      ],
      { occasion: '打篮球' } as never,
      '给我搭配一套打篮球'
    );
    assert.equal(assessments.length, 2);
    assert.equal(assessments[0].status, 'adequate');
    assert.equal(assessments[1].status, 'weak');
  });
});

describe('getEmbeddingSimilarityThresholds', () => {
  it('默认返回 Doubao 阈值', () => {
    const t = getEmbeddingSimilarityThresholds();
    assert.equal(t.search, 0.48);
    assert.equal(t.slotWeak, 0.55);
    assert.equal(t.slotAdequate, 0.62);
    assert.equal(t.slotConfidenceGap, 0.04);
    assert.equal(t.resolveThreshold, 0.68);
    assert.equal(t.ambiguousMin, 0.55);
  });

  it('Vertex 返回更高阈值', () => {
    const originalProvider = process.env.EMBEDDING_PROVIDER;
    const originalVendor = process.env.EMBEDDING_VENDOR;
    process.env.EMBEDDING_PROVIDER = 'vertex';
    delete process.env.EMBEDDING_VENDOR;

    const t = getEmbeddingSimilarityThresholds();
    assert.equal(t.search, 0.5);
    assert.equal(t.slotWeak, 0.58);
    assert.equal(t.slotAdequate, 0.66);

    if (originalProvider !== undefined) process.env.EMBEDDING_PROVIDER = originalProvider;
    else delete process.env.EMBEDDING_PROVIDER;
    if (originalVendor !== undefined) process.env.EMBEDDING_VENDOR = originalVendor;
  });
});
