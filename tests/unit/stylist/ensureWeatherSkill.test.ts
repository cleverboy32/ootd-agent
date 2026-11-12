import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ensureWeatherDressingSkill } from '@/server/agents/stylist/skillSelection';
import { parseTemperatureCelsius } from '@/server/utils/slotTempFilter';

describe('ensureWeatherDressingSkill', () => {
  const hasTemp = (w: string) => parseTemperatureCelsius(w) !== null;

  it('injects weather-dressing when weather has ℃', () => {
    assert.deepEqual(ensureWeatherDressingSkill(['style-sweet'], '约10℃', hasTemp), [
      'weather-dressing',
      'style-sweet',
    ]);
  });

  it('does not duplicate', () => {
    assert.deepEqual(
      ensureWeatherDressingSkill(['weather-dressing', 'style-sweet'], '10℃', hasTemp),
      ['weather-dressing', 'style-sweet']
    );
  });

  it('skips when weather has no parseable temperature', () => {
    assert.deepEqual(ensureWeatherDressingSkill(['style-sweet'], '未知天气', hasTemp), [
      'style-sweet',
    ]);
  });
});
