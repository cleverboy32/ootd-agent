import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applySlotTemperatureFilter,
  calendarSeasonTempHint,
  itemOverlapsTempRange,
  parseTemperatureCelsius,
  resolveSlotTempFilter,
  resolveWeatherDressBand,
  THICKNESS_TEMP_RANGES,
} from '@/server/utils/slotTempFilter';

describe('parseTemperatureCelsius', () => {
  it('parses single celsius', () => {
    assert.equal(parseTemperatureCelsius('晴 18℃'), 18);
    assert.equal(parseTemperatureCelsius('约22度'), 22);
  });

  it('parses range as midpoint', () => {
    assert.equal(parseTemperatureCelsius('约15-20℃'), 18);
    assert.equal(parseTemperatureCelsius('0～8℃'), 4);
  });

  it('rejects unknown weather placeholders', () => {
    assert.equal(parseTemperatureCelsius('未知天气'), null);
    assert.equal(parseTemperatureCelsius('晴'), null);
  });
});

describe('resolveSlotTempFilter sandwich at 10℃', () => {
  it('maps 10℃ to cold band', () => {
    assert.equal(resolveWeatherDressBand(10), 'cold');
  });

  it('outerwear uses thick_outer range', () => {
    const range = resolveSlotTempFilter('cold', 'outerwear');
    assert.deepEqual(range, THICKNESS_TEMP_RANGES.thick_outer);
  });

  it('top uses warm_top range (not ambient containment)', () => {
    const range = resolveSlotTempFilter('cold', 'top');
    assert.deepEqual(range, THICKNESS_TEMP_RANGES.warm_top);
  });

  it('bottom uses thick_bottom range', () => {
    const range = resolveSlotTempFilter('cold', 'bottom');
    assert.deepEqual(range, THICKNESS_TEMP_RANGES.thick_bottom);
  });

  it('keeps warm knit top overlapping warm_top', () => {
    const range = resolveSlotTempFilter('cold', 'top')!;
    assert.equal(itemOverlapsTempRange({ tempMin: 5, tempMax: 15 }, range), true);
  });

  it('drops thin outer against thick_outer target', () => {
    const range = resolveSlotTempFilter('cold', 'outerwear')!;
    assert.equal(itemOverlapsTempRange({ tempMin: 13, tempMax: 25 }, range), false);
    assert.equal(itemOverlapsTempRange({ tempMin: null, tempMax: 12 }, range), true);
  });

  it('rejects short-sleeve solo range for cold top slot', () => {
    const range = resolveSlotTempFilter('cold', 'top')!;
    assert.equal(itemOverlapsTempRange({ tempMin: 22, tempMax: null }, range), false);
  });
});

describe('applySlotTemperatureFilter', () => {
  it('passes through when no target', () => {
    const items = [{ id: 'a', tempMin: 22, tempMax: null }];
    assert.equal(applySlotTemperatureFilter(items, null).length, 1);
  });

  it('keeps dual-null legacy items', () => {
    const items = [
      { id: 'legacy', tempMin: null, tempMax: null },
      { id: 'thin', tempMin: 22, tempMax: null },
    ];
    const filtered = applySlotTemperatureFilter(items, THICKNESS_TEMP_RANGES.thick_outer);
    assert.deepEqual(
      filtered.map((i) => i.id),
      ['legacy']
    );
  });
});

describe('calendarSeasonTempHint', () => {
  it('returns winter range for January in +08', () => {
    const hint = calendarSeasonTempHint(new Date('2026-01-15T04:00:00.000Z'));
    assert.match(hint, /0-8/);
  });
});
