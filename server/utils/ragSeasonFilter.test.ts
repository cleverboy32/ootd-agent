import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { WardrobeSearchResult } from '@/server/services/wardrobeService';
import {
  applySeasonFilter,
  buildSeasonFilterContext,
  shouldExcludeBySeason,
} from './ragSeasonFilter';

function item(
  overrides: Partial<WardrobeSearchResult> & Pick<WardrobeSearchResult, 'id' | 'subCategory'>
): WardrobeSearchResult {
  return {
    imageUrl: 'https://example.com/x.jpg',
    mainCategory: 'OUTERWEAR',
    description: '',
    colors: ['gray'],
    similarity: 0.7,
    season: [],
    material: [],
    tags: [],
    ...overrides,
  };
}

const baseIntent = {
  style_preference: '',
  special_requests: '',
  request_type: 'wardrobe_outfit' as const,
  anchor_item_summary: '',
  anchor_slot: '' as const,
  dressing_climate: '' as const,
};

describe('buildSeasonFilterContext', () => {
  it('uses Gatekeeper dressing_climate warm', () => {
    const ctx = buildSeasonFilterContext({
      ...baseIntent,
      occasion: '周末徒步',
      weather: '',
      dressing_climate: 'warm',
    });
    assert.equal(ctx.dressingClimate, 'warm');
    assert.equal(ctx.isWarmWeather, true);
    assert.equal(ctx.strictColdActivity, false);
  });

  it('uses Gatekeeper dressing_climate cold', () => {
    const ctx = buildSeasonFilterContext({
      ...baseIntent,
      occasion: '上班通勤',
      weather: '',
      dressing_climate: 'cold',
      anchor_item_summary: '灰色长毛呢外套',
      anchor_slot: 'outerwear',
    });
    assert.equal(ctx.dressingClimate, 'cold');
    assert.equal(ctx.isWarmWeather, false);
    assert.ok(ctx.targetSeasons.includes('winter'));
  });

  it('falls back to cold from weather temperature when dressing_climate empty', () => {
    const ctx = buildSeasonFilterContext({
      ...baseIntent,
      occasion: '通勤',
      weather: '5°C',
    });
    assert.equal(ctx.dressingClimate, 'cold');
    assert.equal(ctx.isWarmWeather, false);
  });

  it('defaults to mild when no dressing_climate or weather', () => {
    const ctx = buildSeasonFilterContext({
      ...baseIntent,
      occasion: '上班通勤',
      weather: '',
    });
    assert.equal(ctx.dressingClimate, 'mild');
    assert.deepEqual(ctx.targetSeasons, ['spring', 'summer', 'autumn', 'winter']);
  });

  it('marks skiing as strict cold activity when dressing_climate is cold', () => {
    const ctx = buildSeasonFilterContext(
      {
        ...baseIntent,
        occasion: '滑雪',
        weather: '冬天',
        dressing_climate: 'cold',
      },
      '我冬天去滑雪，可以穿什么呢'
    );
    assert.equal(ctx.isWarmWeather, false);
    assert.equal(ctx.strictColdActivity, true);
  });

  it('does not infer warm from occasion text without dressing_climate', () => {
    const ctx = buildSeasonFilterContext(
      { ...baseIntent, occasion: '周末徒步', weather: '' },
      '这周末我要去爬山徒步'
    );
    assert.equal(ctx.dressingClimate, 'mild');
    assert.equal(ctx.isWarmWeather, false);
  });
});

describe('shouldExcludeBySeason — warm', () => {
  const warmCtx = buildSeasonFilterContext({
    ...baseIntent,
    occasion: '周末徒步',
    weather: '',
    dressing_climate: 'warm',
  });

  it('excludes winter-only puffer in warm outdoor context', () => {
    const puffer = item({
      id: '1',
      subCategory: 'Puffer Jacket',
      season: ['winter'],
      description: 'An oversized charcoal gray hooded puffer jacket',
    });
    assert.equal(shouldExcludeBySeason(puffer, warmCtx, 'outerwear'), true);
  });

  it('keeps windbreaker in warm outdoor context', () => {
    const windbreaker = item({
      id: '2',
      subCategory: 'Windbreaker',
      season: ['spring', 'summer'],
      description: 'A pale yellow lightweight hooded windbreaker',
    });
    assert.equal(shouldExcludeBySeason(windbreaker, warmCtx, 'outerwear'), false);
  });

  it('excludes winter-only season even without puffer keyword', () => {
    const coat = item({
      id: '3',
      subCategory: 'Wool Coat',
      season: ['winter'],
    });
    assert.equal(shouldExcludeBySeason(coat, warmCtx, 'outerwear'), true);
  });
});

describe('shouldExcludeBySeason — cold', () => {
  const skiCtx = buildSeasonFilterContext(
    {
      ...baseIntent,
      occasion: '滑雪',
      weather: '冬天',
      dressing_climate: 'cold',
    },
    '我冬天去滑雪'
  );

  it('excludes summer pants tagged spring/summer/autumn (autumn overlap trap)', () => {
    const linenPants = item({
      id: 'p1',
      mainCategory: 'BOTTOM',
      subCategory: 'Wide-leg Pants',
      season: ['spring', 'summer', 'autumn'],
      description: 'Cream-colored wide-leg linen-blend pants',
    });
    assert.equal(shouldExcludeBySeason(linenPants, skiCtx, 'bottom'), true);
  });

  it('keeps fleece pullover with autumn and winter', () => {
    const fleece = item({
      id: 't1',
      mainCategory: 'TOP',
      subCategory: 'Fleece Pullover',
      season: ['autumn', 'winter'],
    });
    assert.equal(shouldExcludeBySeason(fleece, skiCtx, 'top'), false);
  });

  it('keeps puffer jacket in cold skiing context', () => {
    const puffer = item({
      id: 'o1',
      subCategory: 'Puffer Jacket',
      season: ['autumn', 'winter'],
    });
    assert.equal(shouldExcludeBySeason(puffer, skiCtx, 'outerwear'), false);
  });

  it('excludes autumn-only bottom in strict skiing (no winter tag)', () => {
    const autumnPants = item({
      id: 'p2',
      mainCategory: 'BOTTOM',
      subCategory: 'Corduroy Pants',
      season: ['autumn'],
    });
    assert.equal(shouldExcludeBySeason(autumnPants, skiCtx, 'bottom'), true);
  });
});

describe('shouldExcludeBySeason — mild', () => {
  const mildCtx = buildSeasonFilterContext({
    ...baseIntent,
    occasion: '上班通勤',
    weather: '',
    dressing_climate: 'mild',
  });

  it('does not exclude summer or winter items', () => {
    const puffer = item({ id: '1', subCategory: 'Puffer Jacket', season: ['winter'] });
    const tank = item({
      id: '2',
      mainCategory: 'TOP',
      subCategory: 'Tank Top',
      season: ['summer'],
    });
    assert.equal(shouldExcludeBySeason(puffer, mildCtx, 'outerwear'), false);
    assert.equal(shouldExcludeBySeason(tank, mildCtx, 'top'), false);
  });
});

describe('applySeasonFilter', () => {
  it('removes heavy winter outerwear and keeps lightweight options in warm context', () => {
    const warmCtx = buildSeasonFilterContext({
      ...baseIntent,
      occasion: '周末徒步',
      weather: '',
      dressing_climate: 'warm',
    });
    const results = [
      item({ id: 'p', subCategory: 'Puffer Jacket', season: ['winter'], similarity: 0.72 }),
      item({ id: 'w', subCategory: 'Windbreaker', season: ['spring', 'summer'], similarity: 0.71 }),
    ];
    const filtered = applySeasonFilter(results, warmCtx, 'outerwear', 5);
    assert.deepEqual(
      filtered.map((r) => r.id),
      ['w']
    );
  });

  it('returns empty bottom results for skiing when only summer pants exist', () => {
    const skiCtx = buildSeasonFilterContext({
      ...baseIntent,
      occasion: '滑雪',
      weather: '冬天',
      dressing_climate: 'cold',
    });
    const results = [
      item({
        id: 'p1',
        mainCategory: 'BOTTOM',
        subCategory: 'Wide-leg Pants',
        season: ['spring', 'summer', 'autumn'],
        similarity: 0.59,
      }),
      item({
        id: 'p2',
        mainCategory: 'BOTTOM',
        subCategory: 'Cargo Jeans',
        season: ['spring', 'summer', 'autumn'],
        similarity: 0.58,
      }),
    ];
    const filtered = applySeasonFilter(results, skiCtx, 'bottom', 5);
    assert.deepEqual(filtered, []);
  });
});
