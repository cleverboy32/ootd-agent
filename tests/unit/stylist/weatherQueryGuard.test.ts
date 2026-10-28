import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyWeatherQueryGuard,
  resolveWeatherDressBand,
} from '@/server/agents/stylist/weatherQueryGuard';

describe('resolveWeatherDressBand', () => {
  it('maps 16℃ to cool', () => {
    assert.equal(resolveWeatherDressBand('重庆城区，阴，16℃'), 'cool');
  });
  it('maps 24℃ to comfort', () => {
    assert.equal(resolveWeatherDressBand('24℃ 晴'), 'comfort');
  });
});

describe('applyWeatherQueryGuard', () => {
  const weather = '重庆城区，阴，16℃，西南风≤3级';
  const skills = ['style-sweet', 'weather-dressing'];

  it('does not rewrite skirt bottoms (style owns pants vs skirt)', () => {
    const { queries, changes } = applyWeatherQueryGuard(
      [
        { slot: 'top', query: '短款圆领针织衫' },
        { slot: 'bottom', query: '高腰A字半身裙' },
        { slot: 'outerwear', query: '薄款针织开衫' },
      ],
      { weather, skillNames: skills, userMessage: '下午茶' }
    );
    assert.equal(queries.find((q) => q.slot === 'bottom')?.query, '高腰A字半身裙');
    assert.equal(changes.some((c) => c.slot === 'bottom'), false);
  });

  it('keeps dress route in cool band', () => {
    const { queries, changes } = applyWeatherQueryGuard(
      [
        { slot: 'dress', query: '浅粉针织连衣裙' },
        { slot: 'outerwear', query: '薄针织开衫' },
        { slot: 'shoes', query: '平底单鞋' },
      ],
      { weather, skillNames: skills, userMessage: '甜美通勤' }
    );
    assert.equal(queries.some((q) => q.slot === 'dress'), true);
    assert.equal(changes.some((c) => c.slot === 'dress'), false);
  });

  it('rewrites heavy outerwear in thin band', () => {
    const { queries, changes } = applyWeatherQueryGuard(
      [{ slot: 'outerwear', query: '轻薄羽绒服' }],
      { weather, skillNames: skills, userMessage: '上班' }
    );
    assert.equal(queries[0]?.query, '薄针织开衫');
    assert.ok(changes.some((c) => c.slot === 'outerwear'));
  });

  it('appends thin outerwear when cool sandwich missing outer slot', () => {
    const { queries, changes } = applyWeatherQueryGuard(
      [
        { slot: 'top', query: '奶白色泡泡袖针织衫' },
        { slot: 'bottom', query: '米白色高腰直筒裤' },
      ],
      { weather, skillNames: skills, userMessage: '甜美' }
    );
    assert.ok(queries.some((q) => q.slot === 'outerwear' && q.query === '薄针织开衫'));
    assert.ok(changes.some((c) => c.slot === 'outerwear' && c.from === ''));
  });

  it('rewrites short top in cool band', () => {
    const { queries, changes } = applyWeatherQueryGuard(
      [
        { slot: 'top', query: '短袖T恤' },
        { slot: 'outerwear', query: '薄针织开衫' },
      ],
      { weather, skillNames: skills, userMessage: '出门' }
    );
    assert.equal(queries.find((q) => q.slot === 'top')?.query, '长袖针织衫');
    assert.ok(changes.some((c) => c.slot === 'top'));
  });

  it('drops outerwear in hot band', () => {
    const { queries, changes } = applyWeatherQueryGuard(
      [
        { slot: 'top', query: '短袖衬衫' },
        { slot: 'outerwear', query: '薄针织开衫' },
      ],
      { weather: '30℃ 晴', skillNames: skills, userMessage: '出门' }
    );
    assert.equal(queries.some((q) => q.slot === 'outerwear'), false);
    assert.ok(changes.some((c) => c.slot === 'outerwear' && c.to === ''));
  });

  it('upgrades thin outer to thick in cold band', () => {
    const { queries, changes } = applyWeatherQueryGuard(
      [{ slot: 'outerwear', query: '薄针织开衫' }],
      { weather: '10℃ 阴', skillNames: skills, userMessage: '出门' }
    );
    assert.equal(queries[0]?.query, '大衣');
    assert.ok(changes.some((c) => c.slot === 'outerwear'));
  });

  it('skips when weather skill absent', () => {
    const { changes } = applyWeatherQueryGuard(
      [{ slot: 'bottom', query: '高腰A字半身裙' }],
      { weather, skillNames: ['style-sweet'], userMessage: '下午茶' }
    );
    assert.equal(changes.length, 0);
  });
});
