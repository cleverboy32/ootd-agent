import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { WardrobeSearchResult } from '@/server/services/wardrobeService';
import {
  applySeasonFilter,
  applyWeatherToDressingClimate,
  buildSeasonFilterContext,
  computeDressingClimate,
  resolveDressingClimateForIntent,
  shouldExcludeBySeason,
} from '@/server/utils/ragSeasonFilter';

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
  it('uses warm from weather temperature, ignoring Gatekeeper guess', () => {
    const ctx = buildSeasonFilterContext({
      ...baseIntent,
      occasion: '周末徒步',
      weather: '28°C',
      dressing_climate: 'cold',
    });
    assert.equal(ctx.dressingClimate, 'warm');
    assert.equal(ctx.isWarmWeather, true);
    assert.equal(ctx.strictColdActivity, false);
  });

  it('uses cold from anchor when no weather', () => {
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

  it('uses calendar summer fallback when mild and no weather in July', () => {
    const ctx = buildSeasonFilterContext(
      {
        ...baseIntent,
        occasion: '上班通勤',
        weather: '',
        dressing_climate: 'mild',
      },
      undefined,
      new Date('2026-07-15T12:00:00+08:00')
    );
    assert.equal(ctx.dressingClimate, 'warm');
    assert.equal(ctx.isWarmWeather, true);
    assert.deepEqual(ctx.targetSeasons, ['spring', 'summer']);
    assert.equal(ctx.targetSeasons.includes('winter'), false);
  });

  it('uses calendar spring mild fallback when no weather in April', () => {
    const ctx = buildSeasonFilterContext(
      {
        ...baseIntent,
        occasion: '上班通勤',
        weather: '',
        dressing_climate: 'mild',
      },
      undefined,
      new Date('2026-04-10T12:00:00+08:00')
    );
    assert.equal(ctx.dressingClimate, 'mild');
    assert.deepEqual(ctx.targetSeasons, ['spring', 'summer']);
  });

  it('keeps mild for transitional temperature even when Gatekeeper guessed cold', () => {
    const ctx = buildSeasonFilterContext({
      ...baseIntent,
      occasion: '国庆青海旅行',
      weather: '青海省，晴，18℃',
      dressing_climate: 'cold',
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
      '这周末我要去爬山徒步',
      new Date('2026-04-10T12:00:00+08:00')
    );
    assert.equal(ctx.dressingClimate, 'mild');
    assert.equal(ctx.isWarmWeather, false);
    assert.deepEqual(ctx.targetSeasons, ['spring', 'summer']);
  });
});

describe('applyWeatherToDressingClimate', () => {
  it('corrects Gatekeeper cold to mild for 18°C Qinghai weather', () => {
    const next = applyWeatherToDressingClimate({
      ...baseIntent,
      occasion: '国庆青海旅行',
      weather: '青海省，晴，18℃，东风≤3级',
      dressing_climate: 'cold',
    });
    assert.equal(next.dressing_climate, 'mild');
  });

  it('corrects Gatekeeper mild to warm for hot weather', () => {
    const next = applyWeatherToDressingClimate({
      ...baseIntent,
      occasion: '公园',
      weather: '杭州 晴 28°C',
      dressing_climate: 'mild',
    });
    assert.equal(next.dressing_climate, 'warm');
  });

  it('uses warm from temperature for skiing when weather is hot', () => {
    const next = applyWeatherToDressingClimate({
      ...baseIntent,
      occasion: '滑雪',
      weather: '28°C',
      dressing_climate: 'cold',
    });
    assert.equal(next.dressing_climate, 'warm');
  });

  it('keeps anchor cold for wardrobe_pairing when weather is mild', () => {
    const next = resolveDressingClimateForIntent({
      ...baseIntent,
      request_type: 'wardrobe_pairing',
      occasion: '上班通勤',
      weather: '18°C',
      dressing_climate: 'warm',
      anchor_item_summary: '灰色长毛呢外套',
      anchor_slot: 'outerwear',
    });
    assert.equal(next.dressing_climate, 'cold');
  });
});

describe('computeDressingClimate', () => {
  it('uses skiing activity when weather has no parseable temperature', () => {
    assert.equal(
      computeDressingClimate(
        {
          ...baseIntent,
          occasion: '滑雪',
          weather: '冬天',
          dressing_climate: '',
        },
        '我冬天去滑雪，可以穿什么呢'
      ),
      'cold'
    );
  });
});

describe('shouldExcludeBySeason — calendar narrow mild', () => {
  it('excludes winter-only item in April calendar mild', () => {
    const ctx = buildSeasonFilterContext(
      {
        ...baseIntent,
        occasion: '通勤',
        weather: '',
        dressing_climate: 'mild',
      },
      undefined,
      new Date('2026-04-10T12:00:00+08:00')
    );
    const coat = item({
      id: 'w1',
      subCategory: 'Wool Coat',
      season: ['winter'],
    });
    assert.equal(shouldExcludeBySeason(coat, ctx, 'outerwear'), true);
  });
});

describe('shouldExcludeBySeason — warm', () => {
  const warmCtx = buildSeasonFilterContext({
    ...baseIntent,
    occasion: '周末徒步',
    weather: '28°C',
    dressing_climate: 'cold',
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
  // 有过渡气温 weather 时 mild 仍四季不过滤
  const mildCtx = buildSeasonFilterContext({
    ...baseIntent,
    occasion: '上班通勤',
    weather: '18°C',
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
      weather: '28°C',
      dressing_climate: 'cold',
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
