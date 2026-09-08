import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CITY_WEATHER_FOLLOWUP,
  evaluateCityWeatherGate,
  requestTypeNeedsCityWeatherGate,
  resolveKnownCity,
} from '@/server/utils/cityWeatherGate';
import { parseCityRole, resolveWeatherCity } from '@/server/agents/intent/utils';

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
  it('prefers intent city then profile; never invents from free text', () => {
    assert.equal(resolveKnownCity({ city: '杭州' }), '杭州');
    assert.equal(resolveKnownCity({ profileLocation: '上海' }), '上海');
    assert.equal(resolveKnownCity({ city: '', profileLocation: '上海' }), '上海');
    assert.equal(resolveKnownCity({}), '');
  });
});

describe('resolveWeatherCity', () => {
  it('uses intent city then profile only', () => {
    assert.equal(resolveWeatherCity({ city: '杭州' }, {}), '杭州');
    assert.equal(resolveWeatherCity({ city: '' }, { profileLocation: '上海' }), '上海');
    assert.equal(resolveWeatherCity({ city: '' }, {}), '');
  });

  it('does not treat revision chatter as a city', () => {
    assert.equal(
      resolveWeatherCity({ city: '' }, { profileLocation: undefined }),
      ''
    );
  });
});

describe('parseCityRole', () => {
  it('accepts home and travel only', () => {
    assert.equal(parseCityRole('home'), 'home');
    assert.equal(parseCityRole('TRAVEL'), 'travel');
    assert.equal(parseCityRole(''), '');
    assert.equal(parseCityRole('vacation'), '');
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

  it('passes when profile location known even if weather empty', () => {
    const result = evaluateCityWeatherGate({
      requestType: 'wardrobe_outfit',
      weatherLookupNeeded: true,
      weather: '',
      profileLocation: '成都',
    });
    assert.equal(result.blocked, false);
  });

  it('does not treat free-text noise as a known city', () => {
    const result = evaluateCityWeatherGate({
      requestType: 'wardrobe_outfit',
      weatherLookupNeeded: true,
      weather: '',
      contextText: '额，我咋看不到第二套的新品内搭的样子啊',
    });
    assert.equal(result.blocked, true);
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
