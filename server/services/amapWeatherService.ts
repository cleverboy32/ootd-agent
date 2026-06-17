const AMAP_BASE = 'https://restapi.amap.com/v3';

export interface WeatherSnapshot {
  city: string;
  province: string;
  weather: string;
  temperature: string;
  windDirection: string;
  windPower: string;
  humidity: string;
  reportTime: string;
}

export interface AmapLocation {
  city: string;
  adcode: string;
}

function getApiKey(): string | undefined {
  return process.env.AMAP_WEB_SERVICE_KEY?.trim() || undefined;
}

export function isLocalOrPrivateIp(ip: string | undefined): boolean {
  if (!ip?.trim()) return true;
  const normalized = ip.trim().toLowerCase();
  if (normalized === 'localhost' || normalized === '::1' || normalized === '127.0.0.1') {
    return true;
  }
  if (normalized.startsWith('192.168.') || normalized.startsWith('10.')) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(normalized)) return true;
  return false;
}

function formatWeatherSnapshot(snapshot: WeatherSnapshot): string {
  const city = snapshot.city?.trim() || '当地';
  const weather = snapshot.weather?.trim() || '未知';
  const temperature = snapshot.temperature?.trim() || '';
  const wind =
    snapshot.windDirection?.trim() && snapshot.windPower?.trim()
      ? `，${snapshot.windDirection}风${snapshot.windPower}级`
      : '';
  const humidity = snapshot.humidity?.trim() ? `，湿度${snapshot.humidity}%` : '';
  const time = snapshot.reportTime?.trim();
  const timeSuffix = time ? `（${time} 更新）` : '';

  return `${city}，${weather}，${temperature}℃${wind}${humidity}${timeSuffix}`;
}

async function amapGet<T>(path: string, params: Record<string, string>): Promise<T | null> {
  const key = getApiKey();
  if (!key) {
    console.warn('[AMAP_WEATHER] AMAP_WEB_SERVICE_KEY not configured, skipping');
    return null;
  }

  const url = new URL(`${AMAP_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  url.searchParams.set('key', key);

  try {
    const res = await fetch(url.toString());
    if (!res.ok) {
      console.warn(`[AMAP_WEATHER] HTTP ${res.status} for ${path}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (error) {
    console.warn(`[AMAP_WEATHER] Request failed for ${path}:`, error);
    return null;
  }
}

interface DistrictResponse {
  status: string;
  districts?: Array<{ adcode: string; name: string; level: string }>;
}

interface IpResponse {
  status: string;
  city?: string;
  adcode?: string;
}

interface WeatherResponse {
  status: string;
  lives?: Array<{
    province: string;
    city: string;
    weather: string;
    temperature: string;
    winddirection: string;
    windpower: string;
    humidity: string;
    reporttime: string;
  }>;
}

export async function resolveAdcodeByCity(city: string): Promise<string | null> {
  const keyword = city.trim().replace(/市$/, '');
  if (!keyword) return null;

  const data = await amapGet<DistrictResponse>('/config/district', {
    keywords: keyword,
    subdistrict: '0',
    extensions: 'base',
  });

  if (!data || data.status !== '1' || !data.districts?.length) {
    return null;
  }

  const match =
    data.districts.find((d) => d.level === 'city') ??
    data.districts.find((d) => d.level === 'province') ??
    data.districts[0];

  return match?.adcode ?? null;
}

export async function resolveLocationByIp(ip: string): Promise<AmapLocation | null> {
  if (isLocalOrPrivateIp(ip)) {
    console.log('[AMAP_WEATHER] Skipping IP lookup for local/private IP');
    return null;
  }

  const data = await amapGet<IpResponse>('/ip', { ip: ip.trim() });
  if (!data || data.status !== '1' || !data.adcode || !data.city) {
    return null;
  }

  const city = data.city.replace(/\[\]/g, '').trim();
  if (!city) return null;

  return { city, adcode: data.adcode };
}

export async function fetchLiveWeather(adcode: string): Promise<WeatherSnapshot | null> {
  const code = adcode.trim();
  if (!code) return null;

  const data = await amapGet<WeatherResponse>('/weather/weatherInfo', {
    city: code,
    extensions: 'base',
    output: 'JSON',
  });

  if (!data || data.status !== '1' || !data.lives?.length) {
    return null;
  }

  const live = data.lives[0];
  if (!live || (!live.weather?.trim() && !live.temperature?.trim())) {
    console.warn('[AMAP_WEATHER] Empty or incomplete live weather payload');
    return null;
  }

  return {
    city: live.city ?? '',
    province: live.province ?? '',
    weather: live.weather ?? '',
    temperature: live.temperature ?? '',
    windDirection: live.winddirection ?? '',
    windPower: live.windpower ?? '',
    humidity: live.humidity ?? '',
    reportTime: live.reporttime ?? '',
  };
}

export async function enrichWeather(opts: {
  city?: string;
  ip?: string;
}): Promise<string> {
  try {
    if (opts.city?.trim()) {
      const adcode = await resolveAdcodeByCity(opts.city);
      if (adcode) {
        const snapshot = await fetchLiveWeather(adcode);
        if (snapshot) return formatWeatherSnapshot(snapshot);
      }
    }

    if (opts.ip && !isLocalOrPrivateIp(opts.ip)) {
      const location = await resolveLocationByIp(opts.ip);
      if (location) {
        const snapshot = await fetchLiveWeather(location.adcode);
        if (snapshot) return formatWeatherSnapshot(snapshot);
      }
    }
  } catch (error) {
    console.warn('[AMAP_WEATHER] enrichWeather failed:', error);
  }

  return '';
}
