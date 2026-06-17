import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  enrichWeather,
  fetchLiveWeather,
  isLocalOrPrivateIp,
  resolveAdcodeByCity,
  resolveLocationByIp,
} from '@/server/services/amapWeatherService';

const originalFetch = globalThis.fetch;
const originalKey = process.env.AMAP_WEB_SERVICE_KEY;

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

describe('resolveAdcodeByCity', () => {
  beforeEach(() => {
    process.env.AMAP_WEB_SERVICE_KEY = 'test-key';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env.AMAP_WEB_SERVICE_KEY = originalKey;
  });

  it('returns adcode for a matching district', async () => {
    mockFetch((url) => {
      if (url.includes('/config/district')) {
        return {
          status: '1',
          districts: [{ adcode: '330100', name: '杭州市', level: 'city' }],
        };
      }
      return { status: '0' };
    });

    const adcode = await resolveAdcodeByCity('杭州');
    assert.equal(adcode, '330100');
  });
});

describe('resolveLocationByIp', () => {
  beforeEach(() => {
    process.env.AMAP_WEB_SERVICE_KEY = 'test-key';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env.AMAP_WEB_SERVICE_KEY = originalKey;
  });

  it('skips local IPs', async () => {
    const result = await resolveLocationByIp('127.0.0.1');
    assert.equal(result, null);
  });

  it('returns city and adcode for public IP', async () => {
    mockFetch((url) => {
      if (url.includes('/ip')) {
        return { status: '1', city: '杭州市', adcode: '330100' };
      }
      return { status: '0' };
    });

    const result = await resolveLocationByIp('114.114.114.114');
    assert.deepEqual(result, { city: '杭州市', adcode: '330100' });
  });
});

describe('enrichWeather', () => {
  beforeEach(() => {
    process.env.AMAP_WEB_SERVICE_KEY = 'test-key';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env.AMAP_WEB_SERVICE_KEY = originalKey;
  });

  it('formats live weather by city', async () => {
    mockFetch((url) => {
      if (url.includes('/config/district')) {
        return {
          status: '1',
          districts: [{ adcode: '330100', name: '杭州市', level: 'city' }],
        };
      }
      if (url.includes('/weather/weatherInfo')) {
        return {
          status: '1',
          lives: [
            {
              province: '浙江',
              city: '杭州市',
              weather: '多云',
              temperature: '14',
              winddirection: '西北',
              windpower: '≤3',
              humidity: '97',
              reporttime: '2026-02-02 10:35:13',
            },
          ],
        };
      }
      return { status: '0' };
    });

    const summary = await enrichWeather({ city: '杭州' });
    assert.match(summary, /杭州市/);
    assert.match(summary, /多云/);
    assert.match(summary, /14℃/);
  });

  it('falls back to IP when city is missing', async () => {
    mockFetch((url) => {
      if (url.includes('/ip')) {
        return { status: '1', city: '上海市', adcode: '310100' };
      }
      if (url.includes('/weather/weatherInfo')) {
        return {
          status: '1',
          lives: [
            {
              province: '上海',
              city: '上海市',
              weather: '晴',
              temperature: '20',
              winddirection: '东',
              windpower: '2',
              humidity: '40',
              reporttime: '2026-02-02 12:00:00',
            },
          ],
        };
      }
      return { status: '0' };
    });

    const summary = await enrichWeather({ ip: '114.114.114.114' });
    assert.match(summary, /上海市/);
    assert.match(summary, /晴/);
  });

  it('returns empty string when API key is missing', async () => {
    delete process.env.AMAP_WEB_SERVICE_KEY;
    const summary = await enrichWeather({ city: '杭州' });
    assert.equal(summary, '');
  });

  it('tolerates missing reporttime and other optional fields', async () => {
    mockFetch((url) => {
      if (url.includes('/config/district')) {
        return {
          status: '1',
          districts: [{ adcode: '330100', name: '杭州市', level: 'city' }],
        };
      }
      if (url.includes('/weather/weatherInfo')) {
        return {
          status: '1',
          lives: [{ city: '杭州市', weather: '阴', temperature: '10' }],
        };
      }
      return { status: '0' };
    });

    const summary = await enrichWeather({ city: '杭州' });
    assert.equal(summary, '杭州市，阴，10℃');
  });
});

describe('fetchLiveWeather', () => {
  beforeEach(() => {
    process.env.AMAP_WEB_SERVICE_KEY = 'test-key';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env.AMAP_WEB_SERVICE_KEY = originalKey;
  });

  it('returns null on API failure', async () => {
    mockFetch(() => ({ status: '0' }));
    const snapshot = await fetchLiveWeather('330100');
    assert.equal(snapshot, null);
  });
});
