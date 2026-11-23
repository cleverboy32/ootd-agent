import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applySlotTemperatureFilter,
  calendarSeasonTempHint,
  itemOverlapsTempRange,
  itemTempMidpoint,
  parseTemperatureCelsius,
  resolveDressingFromWeather,
  resolveSlotTempFilter,
  resolveWeatherDressBand,
  THICKNESS_TEMP_RANGES,
} from '@/server/utils/slotTempFilter';
import { readWeatherConditions } from '@/server/utils/weatherInput';

describe('parseTemperatureCelsius', () => {
  it('parses single celsius', () => {
    assert.equal(parseTemperatureCelsius('晴 18℃'), 18);
    assert.equal(parseTemperatureCelsius('约22度'), 22);
  });

  it('parses range as midpoint', () => {
    assert.equal(parseTemperatureCelsius('约15-20℃'), 18);
    assert.equal(parseTemperatureCelsius('0～8℃'), 4);
  });

  it('keeps signed decimals and separates wind, temperature spread, and apparent temperature', () => {
    assert.equal(parseTemperatureCelsius('约15.5℃'), 15.5);
    assert.equal(parseTemperatureCelsius('-0.5℃'), -0.5);
    assert.equal(parseTemperatureCelsius('11℃ 北风4–5级'), 11);
    assert.equal(parseTemperatureCelsius('北风4–5级'), null);
    const conditions = readWeatherConditions('气温 -5.5–-2℃，温差3.5℃，体感 -8–-3℃，风力4–5级，湿度80%');
    assert.deepEqual(conditions.temperature, { min: -5.5, max: -2 });
    assert.deepEqual(conditions.apparentTemperature, { min: -8, max: -3 });
    assert.equal(conditions.windPower, '4–5级');
    assert.equal(conditions.humidity, 80);
  });

  it('rejects unknown weather placeholders', () => {
    assert.equal(parseTemperatureCelsius('未知天气'), null);
    assert.equal(parseTemperatureCelsius('晴'), null);
  });
});

describe('resolveWeatherDressBand new boundaries', () => {
  it('maps key thresholds', () => {
    assert.equal(resolveWeatherDressBand(28), 'hot');
    assert.equal(resolveWeatherDressBand(27), 'warm');
    assert.equal(resolveWeatherDressBand(23), 'warm');
    assert.equal(resolveWeatherDressBand(22), 'comfort');
    assert.equal(resolveWeatherDressBand(18), 'comfort');
    assert.equal(resolveWeatherDressBand(17), 'mild_cool');
    assert.equal(resolveWeatherDressBand(12), 'mild_cool');
    assert.equal(resolveWeatherDressBand(11), 'cool');
    assert.equal(resolveWeatherDressBand(6), 'cool');
    assert.equal(resolveWeatherDressBand(5), 'cold');
    assert.equal(resolveWeatherDressBand(0), 'cold');
    assert.equal(resolveWeatherDressBand(-1), 'freezing');
  });
});

describe('resolveSlotTempFilter sandwich at 10℃ (cool / 初冬)', () => {
  it('maps 10℃ to cool band', () => {
    assert.equal(resolveWeatherDressBand(10), 'cool');
  });

  it('outerwear uses thick_outer range', () => {
    assert.deepEqual(resolveSlotTempFilter('cool', 'outerwear'), THICKNESS_TEMP_RANGES.thick_outer);
  });

  it('top uses warm_top (保暖中间层)', () => {
    assert.deepEqual(resolveSlotTempFilter('cool', 'top'), THICKNESS_TEMP_RANGES.warm_top);
  });

  it('inner_top uses thin_top_long, distinct from mid top', () => {
    const inner = resolveSlotTempFilter('cool', 'inner_top');
    const mid = resolveSlotTempFilter('cool', 'top');
    assert.deepEqual(inner, THICKNESS_TEMP_RANGES.thin_top_long);
    assert.notDeepEqual(inner, mid);
  });

  it('bottom uses thick_bottom range', () => {
    assert.deepEqual(resolveSlotTempFilter('cool', 'bottom'), THICKNESS_TEMP_RANGES.thick_bottom);
  });
});

describe('resolveSlotTempFilter warm～mild_cool: no mid top; cool opens mid', () => {
  it('15℃ mild_cool: two-layer, top null, spring jacket, regular_shoes', () => {
    assert.equal(resolveWeatherDressBand(15), 'mild_cool');
    assert.equal(resolveSlotTempFilter('mild_cool', 'top'), null);
    assert.deepEqual(
      resolveSlotTempFilter('mild_cool', 'inner_top'),
      THICKNESS_TEMP_RANGES.thin_top_long
    );
    assert.deepEqual(
      resolveSlotTempFilter('mild_cool', 'outerwear'),
      THICKNESS_TEMP_RANGES.spring_jacket
    );
    assert.deepEqual(
      resolveSlotTempFilter('mild_cool', 'shoes'),
      THICKNESS_TEMP_RANGES.regular_shoes
    );
  });

  it('comfort 20℃: top null, thin_top_long + thin_outer', () => {
    assert.equal(resolveWeatherDressBand(20), 'comfort');
    assert.equal(resolveSlotTempFilter('comfort', 'top'), null);
    assert.deepEqual(resolveSlotTempFilter('comfort', 'inner_top'), THICKNESS_TEMP_RANGES.thin_top_long);
    assert.deepEqual(resolveSlotTempFilter('comfort', 'outerwear'), THICKNESS_TEMP_RANGES.thin_outer);
    assert.deepEqual(resolveSlotTempFilter('comfort', 'shoes'), THICKNESS_TEMP_RANGES.regular_shoes);
  });

  it('warm 25℃: top null, thin_top_short, regular_shoes', () => {
    assert.equal(resolveWeatherDressBand(25), 'warm');
    assert.equal(resolveSlotTempFilter('warm', 'top'), null);
    assert.deepEqual(resolveSlotTempFilter('warm', 'inner_top'), THICKNESS_TEMP_RANGES.thin_top_short);
    assert.deepEqual(resolveSlotTempFilter('warm', 'shoes'), THICKNESS_TEMP_RANGES.regular_shoes);
  });

  it('cool still opens warm_top mid layer', () => {
    assert.deepEqual(resolveSlotTempFilter('cool', 'top'), THICKNESS_TEMP_RANGES.warm_top);
    assert.deepEqual(resolveSlotTempFilter('cool', 'shoes'), THICKNESS_TEMP_RANGES.regular_shoes);
  });
});

describe('resolveSlotTempFilter cold 0–5℃ and freezing <0℃', () => {
  it('maps 5℃ to cold and -1 to freezing', () => {
    assert.equal(resolveWeatherDressBand(5), 'cold');
    assert.equal(resolveWeatherDressBand(0), 'cold');
    assert.equal(resolveWeatherDressBand(-1), 'freezing');
  });

  it('cold uses thermal_base inner + warm_top + winter_outer', () => {
    assert.deepEqual(resolveSlotTempFilter('cold', 'inner_top'), THICKNESS_TEMP_RANGES.thermal_base);
    assert.deepEqual(resolveSlotTempFilter('cold', 'top'), THICKNESS_TEMP_RANGES.warm_top);
    assert.deepEqual(resolveSlotTempFilter('cold', 'outerwear'), THICKNESS_TEMP_RANGES.winter_outer);
  });

  it('cold/freezing open inner_bottom thermal pants base; warmer bands closed', () => {
    assert.deepEqual(
      resolveSlotTempFilter('cold', 'inner_bottom'),
      THICKNESS_TEMP_RANGES.thermal_bottom_base
    );
    assert.deepEqual(
      resolveSlotTempFilter('freezing', 'inner_bottom'),
      THICKNESS_TEMP_RANGES.thermal_bottom_base
    );
    assert.equal(resolveSlotTempFilter('cool', 'inner_bottom'), null);
    assert.equal(resolveSlotTempFilter('mild_cool', 'inner_bottom'), null);
    assert.equal(resolveSlotTempFilter('hot', 'inner_bottom'), null);
  });

  it('at 5℃ only widens the outer-pants filter for an outfit with a thermal bottom layer', () => {
    const dressing = resolveDressingFromWeather('约5℃')!;
    const pants = [{ tempMin: 8, tempMax: 22 }, { tempMin: 12, tempMax: 24 }];
    assert.deepEqual(dressing.slotRange('bottom', true), { min: 5, max: 14 });
    assert.deepEqual(applySlotTemperatureFilter(pants, dressing.slotRange('bottom', true)), pants);
    assert.deepEqual(applySlotTemperatureFilter(pants, dressing.slotRange('bottom')), []);
    assert.deepEqual(dressing.slotRange('skirt', true), { min: -8, max: 6 });
    assert.deepEqual(resolveSlotTempFilter('freezing', 'bottom', true), { min: -8, max: 6 });
  });

  it('freezing keeps three upper slots with winter_outer', () => {
    assert.deepEqual(resolveSlotTempFilter('freezing', 'inner_top'), THICKNESS_TEMP_RANGES.thermal_base);
    assert.deepEqual(resolveSlotTempFilter('freezing', 'top'), THICKNESS_TEMP_RANGES.warm_top);
    assert.deepEqual(resolveSlotTempFilter('freezing', 'outerwear'), THICKNESS_TEMP_RANGES.winter_outer);
  });

  it('hot band does not temp-filter inner_top', () => {
    assert.equal(resolveSlotTempFilter('hot', 'inner_top'), null);
  });
});

describe('itemTempMidpoint / itemOverlapsTempRange interval overlap', () => {
  it('computes closed / open midpoints (diagnostic only)', () => {
    assert.equal(itemTempMidpoint({ tempMin: 16, tempMax: 24 }), 20);
    assert.equal(itemTempMidpoint({ tempMin: 24, tempMax: 35 }), 29.5);
    assert.equal(itemTempMidpoint({ tempMin: null, tempMax: null }), null);
  });

  it('thin_top_long [16,23] keeps long sleeve, rejects short sleeve at 24', () => {
    assert.equal(
      itemOverlapsTempRange({ tempMin: 16, tempMax: 23 }, THICKNESS_TEMP_RANGES.thin_top_long),
      true
    );
    assert.equal(
      itemOverlapsTempRange({ tempMin: 24, tempMax: 35 }, THICKNESS_TEMP_RANGES.thin_top_long),
      false
    );
    assert.equal(
      itemOverlapsTempRange({ tempMin: 16, tempMax: 23 }, THICKNESS_TEMP_RANGES.thin_top_short),
      false
    );
  });

  it('regular_bottom [12,23] rejects shorts thin_bottom at 24', () => {
    assert.equal(
      itemOverlapsTempRange({ tempMin: 24, tempMax: 38 }, THICKNESS_TEMP_RANGES.regular_bottom),
      false
    );
    assert.equal(
      itemOverlapsTempRange({ tempMin: 12, tempMax: 23 }, THICKNESS_TEMP_RANGES.thin_bottom),
      false
    );
  });

  it('thick_bottom [4,11] cut from regular_bottom [12,23]', () => {
    assert.deepEqual(THICKNESS_TEMP_RANGES.thick_bottom, { min: 4, max: 11 });
    assert.equal(
      itemOverlapsTempRange({ tempMin: 4, tempMax: 11 }, THICKNESS_TEMP_RANGES.regular_bottom),
      false
    );
    assert.equal(
      itemOverlapsTempRange({ tempMin: 5, tempMax: 11 }, THICKNESS_TEMP_RANGES.regular_bottom),
      false
    );
    assert.equal(
      itemOverlapsTempRange({ tempMin: 4, tempMax: 11 }, THICKNESS_TEMP_RANGES.thick_bottom),
      true
    );
    assert.equal(
      itemOverlapsTempRange({ tempMin: 5, tempMax: 11 }, THICKNESS_TEMP_RANGES.thick_bottom),
      true
    );
    assert.deepEqual(resolveSlotTempFilter('cool', 'skirt'), THICKNESS_TEMP_RANGES.thick_bottom);
  });

  it('rejects disjoint ranges (sandals vs closed_shoes)', () => {
    assert.equal(
      itemOverlapsTempRange({ tempMin: 25, tempMax: 38 }, THICKNESS_TEMP_RANGES.closed_shoes),
      false
    );
  });

  it('keeps thermal_base intersecting [-15,4]; rejects warm_top [5,14]', () => {
    assert.equal(
      itemOverlapsTempRange({ tempMin: -15, tempMax: 4 }, THICKNESS_TEMP_RANGES.thermal_base),
      true
    );
    // legacy 德绒标 -15~8 仍与槽 [-15,4] 相交，召回不空
    assert.equal(
      itemOverlapsTempRange({ tempMin: -15, tempMax: 8 }, THICKNESS_TEMP_RANGES.thermal_base),
      true
    );
    assert.equal(
      itemOverlapsTempRange({ tempMin: 5, tempMax: 14 }, THICKNESS_TEMP_RANGES.thermal_base),
      false
    );
  });
});

describe('applySlotTemperatureFilter', () => {
  it('passes through when no target', () => {
    assert.equal(applySlotTemperatureFilter([{ id: 'a', tempMin: 24, tempMax: 35 }], null).length, 1);
  });

  it('drops items with no interval overlap against slot range', () => {
    const filtered = applySlotTemperatureFilter(
      [
        { id: 'tee', tempMin: 24, tempMax: 35 },
        { id: 'base', tempMin: 16, tempMax: 23 },
        { id: 'coat', tempMin: -8, tempMax: 5 },
      ],
      THICKNESS_TEMP_RANGES.thin_top_long
    );
    assert.deepEqual(
      filtered.map((i) => i.id),
      ['base']
    );
  });
});

describe('weather protection and cross-band dressing', () => {
  it('keeps the measured band in strong wind, with a wind protection hint', () => {
    const resolved = resolveDressingFromWeather('11℃ 北风4–5级')!;
    assert.deepEqual(resolved.dressingRange, { min: 11, max: 11 });
    assert.equal(resolved.band, 'cool');
    assert.match(resolved.planHint, /防风/);
    assert.equal(resolveDressingFromWeather('30℃ 东风4级')?.band, 'hot');
    assert.doesNotMatch(resolveDressingFromWeather('10℃ 东北风≤3级')!.planHint, /天气防护/);
  });

  it('uses humidity for protection and fabric selection without shifting bands', () => {
    const cold = resolveDressingFromWeather('9℃ 湿度80%')!;
    const warm = resolveDressingFromWeather('29℃ 湿度85%')!;
    assert.equal(cold.band, 'cool');
    assert.match(cold.planHint, /防湿/);
    assert.equal(warm.band, 'hot');
    assert.match(warm.planHint, /透气速干/);
  });

  it('uses apparent temperatures for the matching time span and keeps ambient measurements available', () => {
    const resolved = resolveDressingFromWeather({
      weather: '9℃',
      weatherConditions: {
        temperature: { min: 10, max: 18 },
        apparentTemperature: { min: 8, max: 16 },
        windPower: '5级',
        humidity: 80,
      },
    })!;
    assert.deepEqual(resolved.temperatureRange, { min: 10, max: 18 });
    assert.deepEqual(resolved.dressingRange, { min: 8, max: 16 });
    assert.match(resolved.planHint, /体感约 8–16℃/);
    assert.deepEqual(resolveDressingFromWeather('气温10–18℃，当前体感8℃')?.dressingRange, { min: 10, max: 18 });
  });

  it('uses one set of slots for a warm base and a detachable outer layer at 10–18℃', () => {
    const resolved = resolveDressingFromWeather('温度10–18℃')!;
    assert.equal(resolved.band, 'cool');
    assert.equal(resolved.baseBand, 'comfort');
    assert.deepEqual(resolved.slotRange('inner_top'), THICKNESS_TEMP_RANGES.thin_top_long);
    assert.deepEqual(resolved.slotRange('outerwear'), THICKNESS_TEMP_RANGES.mid_outer);
    assert.deepEqual(resolved.slotRange('bottom'), THICKNESS_TEMP_RANGES.regular_bottom);
    assert.equal(resolved.slotRange('top'), null);
    assert.equal(resolved.slotRange('inner_bottom'), null);
    assert.match(resolved.planHint, /同一套单品.*18℃.*10℃.*穿脱方式不占用独立 outfit id/);
  });
});

describe('resolveDressingFromWeather planHint', () => {
  it('returns null when weather has no celsius', () => {
    assert.equal(resolveDressingFromWeather('晴'), null);
  });

  it('for 15℃ mild_cool: two-layer, no mid top, regular_shoes', () => {
    const hint = resolveDressingFromWeather('约15℃')?.planHint;
    assert.ok(hint);
    assert.match(hint!, /档=mild_cool/);
    assert.match(hint!, /inner_top: 开/);
    assert.match(hint!, /top: 本档不开/);
    assert.match(hint!, /outerwear: 开/);
    assert.match(hint!, /spring_jacket/);
    assert.match(hint!, /regular_shoes/);
  });

  it('for 5℃ cold: opens three upper slots with winter_outer', () => {
    const hint = resolveDressingFromWeather('约5℃')?.planHint;
    assert.ok(hint);
    assert.match(hint!, /档=cold/);
    assert.match(hint!, /thermal_base/);
    assert.match(hint!, /warm_top/);
    assert.match(hint!, /winter_outer/);
  });

  it('for -2℃ freezing', () => {
    const hint = resolveDressingFromWeather('约-2℃')?.planHint;
    assert.ok(hint);
    assert.match(hint!, /档=freezing/);
  });
});

describe('resolveSlotTempFilter shoes', () => {
  it('mild_cool / cool use regular_shoes', () => {
    assert.deepEqual(
      resolveSlotTempFilter('mild_cool', 'shoes'),
      THICKNESS_TEMP_RANGES.regular_shoes
    );
    assert.deepEqual(resolveSlotTempFilter('cool', 'shoes'), THICKNESS_TEMP_RANGES.regular_shoes);
  });

  it('cold uses warm_boots and keeps snow boot', () => {
    const range = resolveSlotTempFilter('cold', 'shoes')!;
    assert.deepEqual(range, THICKNESS_TEMP_RANGES.warm_boots);
    assert.equal(itemOverlapsTempRange({ tempMin: -20, tempMax: 4 }, range), true);
  });

  it('hot uses thin_shoes and rejects warm boots', () => {
    const range = resolveSlotTempFilter('hot', 'shoes')!;
    assert.deepEqual(range, THICKNESS_TEMP_RANGES.thin_shoes);
    assert.equal(itemOverlapsTempRange({ tempMin: -20, tempMax: 4 }, range), false);
  });
});

describe('calendarSeasonTempHint', () => {
  it('returns winter range for January in +08', () => {
    const hint = calendarSeasonTempHint(new Date('2026-01-15T04:00:00.000Z'));
    assert.match(hint, /0-8/);
  });
});
