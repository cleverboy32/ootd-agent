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

  it('rewrites heavy outerwear in cool/mid band to mid-weight', () => {
    const { queries, changes } = applyWeatherQueryGuard(
      [{ slot: 'outerwear', query: '轻薄羽绒服' }],
      { weather, skillNames: skills, userMessage: '上班' }
    );
    assert.equal(queries[0]?.query, '摇粒绒外套');
    assert.ok(changes.some((c) => c.slot === 'outerwear'));
  });

  it('keeps mid-weight 薄棉服 in cool band', () => {
    const { queries, changes } = applyWeatherQueryGuard(
      [{ slot: 'outerwear', query: '薄棉服 立领' }],
      { weather, skillNames: skills, userMessage: '上班' }
    );
    assert.equal(queries[0]?.query, '薄棉服 立领');
    assert.equal(changes.length, 0);
  });

  it('upgrades thin outer to mid-weight in cool band', () => {
    const { queries, changes } = applyWeatherQueryGuard(
      [{ slot: 'outerwear', query: '薄针织开衫' }],
      { weather, skillNames: skills, userMessage: '出门' }
    );
    assert.equal(queries[0]?.query, '摇粒绒外套');
    assert.ok(changes.some((c) => c.slot === 'outerwear' && c.to === '摇粒绒外套'));
  });

  it('rewrites plain 大衣 (not only 厚大衣) in mild_cool 19℃', () => {
    const { queries, changes } = applyWeatherQueryGuard(
      [{ slot: 'outerwear', query: '简约羊毛大衣 燕麦色', outfitId: 'outfit_2' }],
      {
        weather: '重庆城区，多云，19℃',
        skillNames: skills,
        userMessage: '第二套外套有点冷，换个外套吧',
        specialRequests: '外套有点冷，换个外套',
      }
    );
    assert.equal(queries[0]?.query, '薄针织开衫');
    assert.ok(changes.some((c) => c.from.includes('大衣') && c.to === '薄针织开衫'));
  });

  it('keeps 大衣 when user named thick outer', () => {
    const { queries, changes } = applyWeatherQueryGuard(
      [{ slot: 'outerwear', query: '驼色羊毛大衣' }],
      {
        weather: '重庆城区，多云，19℃',
        skillNames: skills,
        userMessage: '换件大衣',
        specialRequests: '外套换成大衣',
      }
    );
    assert.equal(queries[0]?.query, '驼色羊毛大衣');
    assert.equal(changes.length, 0);
  });

  it('does not rewrite 薄风衣 in mild_cool', () => {
    const { queries, changes } = applyWeatherQueryGuard(
      [{ slot: 'outerwear', query: '燕麦色薄风衣' }],
      { weather: '重庆城区，多云，19℃', skillNames: skills, userMessage: '通勤' }
    );
    assert.equal(queries[0]?.query, '燕麦色薄风衣');
    assert.equal(changes.length, 0);
  });

  it('appends mid outerwear when cool sandwich missing outer slot', () => {
    const { queries, changes } = applyWeatherQueryGuard(
      [
        { slot: 'top', query: '奶白色泡泡袖针织衫' },
        { slot: 'bottom', query: '米白色高腰直筒裤' },
      ],
      { weather, skillNames: skills, userMessage: '甜美' }
    );
    assert.ok(queries.some((q) => q.slot === 'outerwear' && q.query === '摇粒绒外套'));
    assert.ok(changes.some((c) => c.slot === 'outerwear' && c.from === ''));
  });

  it('appends thin outerwear when mild_cool sandwich missing outer slot', () => {
    const { queries, changes } = applyWeatherQueryGuard(
      [
        { slot: 'top', query: '长袖衬衫' },
        { slot: 'bottom', query: '直筒裤' },
      ],
      {
        weather: '重庆城区，多云，19℃',
        skillNames: skills,
        userMessage: '通勤',
      }
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
