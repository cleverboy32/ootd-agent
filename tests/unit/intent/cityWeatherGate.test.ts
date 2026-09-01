import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CITY_WEATHER_FOLLOWUP,
  evaluateCityWeatherGate,
  requestTypeNeedsCityWeatherGate,
  resolveKnownCity,
} from '@/server/utils/cityWeatherGate';

describe('requestTypeNeedsCityWeatherGate', () => {
  it('gates outfit generating types only', () => {
    assert.equal(requestTypeNeedsCityWeatherGate('wardrobe_outfit'), true);
    assert.equal(requestTypeNeedsCityWeatherGate('wardrobe_pairing'), true);
    assert.equal(requestTypeNeedsCityWeatherGate('purchase_pairing'), true);
    assert.equal(requestTypeNeedsCityWeatherGate('style_advice'), false);
    assert.equal(requestTypeNeedsCityWeatherGate('feedback_revision'), false);
  });
});

describe('resolveKnownCity', () => {
  it('prefers intent city then profile then text', () => {
    assert.equal(resolveKnownCity({ city: '杭州' }), '杭州');
    assert.equal(resolveKnownCity({ profileLocation: '上海' }), '上海');
    assert.equal(resolveKnownCity({ contextText: '我在成都' }), '成都');
  });
});

describe('evaluateCityWeatherGate', () => {
  it('blocks when weather needed, no weather, no city', () => {
    const result = evaluateCityWeatherGate({
      requestType: 'wardrobe_outfit',
      weatherLookupNeeded: true,
      weather: '',
    });
    assert.equal(result.blocked, true);
    assert.equal(result.followup, CITY_WEATHER_FOLLOWUP);
  });

  it('passes when IP/city already produced weather', () => {
    const result = evaluateCityWeatherGate({
      requestType: 'wardrobe_outfit',
      weatherLookupNeeded: true,
      weather: '杭州 晴 28°C',
    });
    assert.equal(result.blocked, false);
  });

  it('passes when city known even if weather empty', () => {
    const result = evaluateCityWeatherGate({
      requestType: 'wardrobe_outfit',
      weatherLookupNeeded: true,
      weather: '',
      city: '杭州',
    });
    assert.equal(result.blocked, false);
  });

  it('passes for style_advice and feedback_revision', () => {
    assert.equal(
      evaluateCityWeatherGate({
        requestType: 'style_advice',
        weatherLookupNeeded: true,
        weather: '',
      }).blocked,
      false
    );
    assert.equal(
      evaluateCityWeatherGate({
        requestType: 'feedback_revision',
        weatherLookupNeeded: true,
        weather: '',
      }).blocked,
      false
    );
  });

  it('passes when weather lookup not needed', () => {
    assert.equal(
      evaluateCityWeatherGate({
        requestType: 'wardrobe_outfit',
        weatherLookupNeeded: false,
        weather: '',
      }).blocked,
      false
    );
  });
});
