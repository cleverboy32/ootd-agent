import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applySlotTemperatureFilter,
  itemOverlapsTempRange,
  resolveDressingFromWeather,
} from '@/server/utils/slotTempFilter';

describe('anchor candidate slotTempRange filter (sandwich)', () => {
  const sleeveless = {
    id: 'dress-summer',
    tempMin: 24,
    tempMax: 38 as number | null,
    similarity: 0.61,
  };
  const regularDress = {
    id: 'dress-mild',
    tempMin: 12,
    tempMax: 23 as number | null,
    similarity: 0.55,
  };
  const winterDress = {
    id: 'dress-winter',
    tempMin: -8,
    tempMax: 6 as number | null,
    similarity: 0.5,
  };

  it('at 15℃ dress slot uses regular_bottom; rejects thin summer dress, drops winter', () => {
    const range = resolveDressingFromWeather('阴天约15℃')?.slotRange('dress') ?? null;
    assert.ok(range);
    assert.deepEqual(range, { min: 12, max: 23 });
    // 短裤/薄夏裙 [24,38] 与常规下装 [12,23] 无交叠
    assert.equal(itemOverlapsTempRange(sleeveless, range!), false);
    assert.equal(itemOverlapsTempRange(regularDress, range!), true);
    assert.equal(itemOverlapsTempRange(winterDress, range!), false);
    const filtered = applySlotTemperatureFilter(
      [sleeveless, regularDress, winterDress],
      range
    );
    assert.deepEqual(
      filtered.map((item) => item.id),
      ['dress-mild']
    );
  });

  it('keeps all when weather has no parseable temperature (no slot range)', () => {
    const range = resolveDressingFromWeather('')?.slotRange('dress') ?? null;
    assert.equal(range, null);
    const filtered = applySlotTemperatureFilter([sleeveless], range);
    assert.equal(filtered.length, 1);
  });
});
