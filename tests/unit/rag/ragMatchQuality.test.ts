import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assessSlotMatch,
  buildSlotMatchAssessments,
  isAthleticOccasion,
  isItemAthleticallyAppropriate,
  filterResultsForAthleticContext,
} from '@/server/utils/ragMatchQuality';
import type { WardrobeSearchResult } from '@/server/services/wardrobeService';

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

describe('assessSlotMatch', () => {
  it('运动场景下 Wrap Shorts 高分仍判 weak', () => {
    const assessment = assessSlotMatch(
      [
        item({
          id: 'w',
          subCategory: 'Wrap Shorts',
          similarity: 0.82,
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
          similarity: 0.85,
          tags: ['athletic', 'sporty'],
        }),
      ],
      'top',
      true
    );
    assert.equal(assessment.status, 'adequate');
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
              similarity: 0.85,
              tags: ['athletic'],
            }),
          ],
        },
        {
          slot: 'bottom',
          results: [
            item({ id: 'w', subCategory: 'Wrap Shorts', similarity: 0.8 }),
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
