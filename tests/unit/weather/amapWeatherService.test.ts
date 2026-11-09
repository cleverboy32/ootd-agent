import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWeatherCacheKey,
  clearWeatherCache,
  enrichWeather,
  fetchLiveWeather,
  fetchWeatherByCity,
  formatWeatherCacheDate,
  getWeatherCacheSize,
  isLocalOrPrivateIp,
  normalizeWeatherCityKey,
  parseCityFromIpRegion,
  purgePastWeatherCache,
  resolveAdcodeByCity,
  resolveLocationByIp,
  seedWeatherCache,
  type WeatherSnapshot,
} from '@/server/services/amapWeatherService';

const originalFetch = globalThis.fetch;
const originalKey = process.env.UAPI_API_KEY;

const sampleSnapshot = (city = '成都'): WeatherSnapshot => ({
  city,
  province: '四川省',
  weather: '晴',
  temperature: '22',
  windDirection: '南风',
  windPower: '2级',
  humidity: '50',
  reportTime: '11:00',
});

function mockFetch(handler: (url: string) => unknown) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    const body = handler(url);
    return {
      ok: true,
      json: async () => body,
    } as Response;
  }) as typeof fetch;
}

describe('isLocalOrPrivateIp', () => {
  it('detects loopback and private ranges', () => {
    assert.equal(isLocalOrPrivateIp('127.0.0.1'), true);
    assert.equal(isLocalOrPrivateIp('::1'), true);
    assert.equal(isLocalOrPrivateIp('192.168.1.10'), true);
    assert.equal(isLocalOrPrivateIp('10.0.0.5'), true);
    assert.equal(isLocalOrPrivateIp(undefined), true);
    assert.equal(isLocalOrPrivateIp('8.8.8.8'), false);
  });
});

describe('parseCityFromIpRegion', () => {
  it('takes the last segment as city', () => {
    assert.equal(parseCityFromIpRegion('中国 江苏 南京'), '南京');
    assert.equal(parseCityFromIpRegion('中国 重庆市'), '重庆');
    assert.equal(parseCityFromIpRegion('杭州'), '杭州');
  });
});

describe('resolveAdcodeByCity', () => {
  it('returns normalized city token for UAPI city query', async () => {
    const adcode = await resolveAdcodeByCity('杭州市');
    assert.equal(adcode, '杭州');
  });
});

describe('resolveLocationByIp', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('skips local IPs', async () => {
    const result = await resolveLocationByIp('127.0.0.1');
    assert.equal(result, null);
  });

  it('returns city from UAPI ipinfo region', async () => {
    mockFetch((url) => {
      if (url.includes('/network/ipinfo')) {
        return { ip: '114.114.114.114', region: '中国 江苏 南京' };
      }
      return { code: 'NOT_FOUND' };
    });

    const result = await resolveLocationByIp('114.114.114.114');
    assert.deepEqual(result, { city: '南京', adcode: '' });
  });
});

describe('weather cache helpers', () => {
  afterEach(() => {
    clearWeatherCache();
  });

  it('normalizes city and builds city|date key', () => {
    assert.equal(normalizeWeatherCityKey('成都市'), '成都');
    assert.equal(buildWeatherCacheKey('成都市', '2026-11-09'), '成都|2026-11-09');
  });

  it('purgePastWeatherCache drops dates before today', () => {
    const today = formatWeatherCacheDate();
    const yesterdayMs = Date.now() - 24 * 60 * 60 * 1000;
    seedWeatherCache('成都', sampleSnapshot(), { nowMs: yesterdayMs });
    seedWeatherCache('杭州', sampleSnapshot('杭州'));
    assert.equal(getWeatherCacheSize(), 2);

    const removed = purgePastWeatherCache();
    assert.equal(removed, 1);
    assert.equal(getWeatherCacheSize(), 1);
    assert.equal(buildWeatherCacheKey('杭州', today), `杭州|${today}`);
  });
});

describe('enrichWeather', () => {
  beforeEach(() => {
    clearWeatherCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env.UAPI_API_KEY = originalKey;
    clearWeatherCache();
  });

  it('formats live weather by city via UAPI', async () => {
    mockFetch((url) => {
      if (url.includes('/misc/weather') && url.includes('city=')) {
        return {
          province: '浙江省',
          city: '杭州',
          weather: '多云',
          temperature: 14,
          wind_direction: '西北风',
          wind_power: '≤3级',
          humidity: 97,
          report_time: '2026-02-02 10:35:13',
        };
      }
      return { code: 'NOT_FOUND' };
    });

    const summary = await enrichWeather({ city: '杭州' });
    assert.match(summary, /杭州/);
    assert.match(summary, /多云/);
    assert.match(summary, /14℃/);
    assert.match(summary, /西北风/);
  });

  it('falls back to IP → city → weather', async () => {
    mockFetch((url) => {
      if (url.includes('/network/ipinfo')) {
        return { ip: '114.114.114.114', region: '中国 上海 上海' };
      }
      if (url.includes('/misc/weather')) {
        return {
          province: '上海市',
          city: '上海',
          weather: '晴',
          temperature: 20,
          wind_direction: '东风',
          wind_power: '2级',
          humidity: 40,
          report_time: '12:00 更新',
        };
      }
      return { code: 'NOT_FOUND' };
    });

    const summary = await enrichWeather({ ip: '114.114.114.114' });
    assert.match(summary, /上海/);
    assert.match(summary, /晴/);
    assert.match(summary, /20℃/);
  });

  it('works without API key on free tier path', async () => {
    delete process.env.UAPI_API_KEY;
    mockFetch((url) => {
      if (url.includes('/misc/weather')) {
        return {
          city: '杭州',
          weather: '阴',
          temperature: 10,
        };
      }
      return { code: 'NOT_FOUND' };
    });

    const summary = await enrichWeather({ city: '杭州' });
    assert.equal(summary, '杭州，阴，10℃');
  });

  it('tolerates missing optional fields', async () => {
    mockFetch(() => ({
      city: '杭州',
      weather: '阴',
      temperature: 10,
    }));

    const summary = await enrichWeather({ city: '杭州' });
    assert.equal(summary, '杭州，阴，10℃');
  });
});

describe('fetchWeatherByCity / fetchLiveWeather', () => {
  beforeEach(() => {
    process.env.UAPI_API_KEY = 'test-key';
    clearWeatherCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env.UAPI_API_KEY = originalKey;
    clearWeatherCache();
  });

  it('fetchWeatherByCity returns null on API failure', async () => {
    mockFetch(() => ({ code: 'NOT_FOUND', message: 'not found' }));
    const snapshot = await fetchWeatherByCity('杭州');
    assert.equal(snapshot, null);
    assert.equal(getWeatherCacheSize(), 0);
  });

  it('fetchWeatherByCity caches by city|date and reuses within TTL', async () => {
    let calls = 0;
    mockFetch((url) => {
      assert.match(url, /city=/);
      calls += 1;
      return {
        city: '成都',
        weather: '多云',
        temperature: 18,
        wind_direction: '北风',
        wind_power: '1级',
        humidity: 60,
        report_time: '11:00',
      };
    });

    const first = await fetchWeatherByCity('成都市');
    const second = await fetchWeatherByCity('成都');
    assert.equal(calls, 1);
    assert.equal(first?.temperature, '18');
    assert.deepEqual(second, first);
    assert.equal(getWeatherCacheSize(), 1);
  });

  it('fetchWeatherByCity refetches after TTL expires (same key overwritten)', async () => {
    seedWeatherCache('成都', sampleSnapshot(), { ttlMs: -1 });
    let calls = 0;
    mockFetch(() => {
      calls += 1;
      return {
        city: '成都',
        weather: '阴',
        temperature: 16,
      };
    });

    const snapshot = await fetchWeatherByCity('成都');
    assert.equal(calls, 1);
    assert.equal(snapshot?.weather, '阴');
    assert.equal(snapshot?.temperature, '16');
    assert.equal(getWeatherCacheSize(), 1);
  });

  it('fetchLiveWeather queries by adcode', async () => {
    mockFetch((url) => {
      assert.match(url, /adcode=330100/);
      return {
        city: '杭州',
        weather: '晴',
        temperature: 22,
        wind_direction: '东风',
        wind_power: '1级',
        humidity: 55,
      };
    });

    const snapshot = await fetchLiveWeather('330100');
    assert.equal(snapshot?.city, '杭州');
    assert.equal(snapshot?.temperature, '22');
  });
});
