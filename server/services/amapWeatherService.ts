/**
 * 天气查询：UApiPro `GET /api/v1/misc/weather`
 * @see https://uapis.cn/docs/api-reference/get-misc-weather
 *
 * 城市名可直接查；无城市时先用 `GET /api/v1/network/ipinfo` 解析客户端 IP 城市再查天气。
 * 免费层可不配 key；有 `UAPI_API_KEY` 时带 Bearer。
 *
 * 缓存：key = `城市|YYYY-MM-DD`，同 key 带 TTL；过期后同 key 覆盖刷新；
 * 每天定时清掉日期 < 今天 的条目。
 */

const UAPI_BASE = 'https://uapis.cn/api/v1';

/** 当天实时天气缓存新鲜度（同 city|date 覆盖刷新）。 */
export const WEATHER_CACHE_TTL_MS = 60 * 60 * 1000;
const WEATHER_CACHE_PURGE_INTERVAL_MS = 60 * 60 * 1000;

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

interface WeatherCacheEntry {
  snapshot: WeatherSnapshot;
  /** 本地日历日 YYYY-MM-DD */
  date: string;
  expireAt: number;
}

const weatherCache = new Map<string, WeatherCacheEntry>();
let weatherCachePurgeTimer: ReturnType<typeof setInterval> | null = null;

function getApiKey(): string | undefined {
  return (
    process.env.UAPI_API_KEY?.trim() ||
    process.env.UAPIS_API_KEY?.trim() ||
    undefined
  );
}

/** 缓存用城市名：去空白、去尾「市」。 */
export function normalizeWeatherCityKey(city: string): string {
  return city.trim().replace(/市$/u, '');
}

/** 本地时区 YYYY-MM-DD。 */
export function formatWeatherCacheDate(nowMs: number = Date.now()): string {
  const d = new Date(nowMs);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function buildWeatherCacheKey(city: string, date: string): string {
  return `${normalizeWeatherCityKey(city)}|${date}`;
}

function ensureWeatherCachePurgeScheduled(): void {
  if (weatherCachePurgeTimer || typeof setInterval !== 'function') return;
  weatherCachePurgeTimer = setInterval(() => {
    purgePastWeatherCache();
  }, WEATHER_CACHE_PURGE_INTERVAL_MS);
  weatherCachePurgeTimer.unref?.();
}

/** 删除 date < 今天 的缓存；返回删除条数。 */
export function purgePastWeatherCache(nowMs: number = Date.now()): number {
  const today = formatWeatherCacheDate(nowMs);
  let removed = 0;
  for (const [key, entry] of weatherCache) {
    if (entry.date < today) {
      weatherCache.delete(key);
      removed += 1;
    }
  }
  return removed;
}

export function clearWeatherCache(): void {
  weatherCache.clear();
}

export function getWeatherCacheSize(): number {
  return weatherCache.size;
}

/** 测试/调试：写入一条缓存；可指定 now / TTL。 */
export function seedWeatherCache(
  city: string,
  snapshot: WeatherSnapshot,
  opts?: { nowMs?: number; ttlMs?: number },
): string {
  const nowMs = opts?.nowMs ?? Date.now();
  const ttlMs = opts?.ttlMs ?? WEATHER_CACHE_TTL_MS;
  const date = formatWeatherCacheDate(nowMs);
  const key = buildWeatherCacheKey(city, date);
  weatherCache.set(key, {
    snapshot,
    date,
    expireAt: nowMs + ttlMs,
  });
  return key;
}

function readWeatherCache(city: string, nowMs: number = Date.now()): WeatherSnapshot | null {
  ensureWeatherCachePurgeScheduled();
  const date = formatWeatherCacheDate(nowMs);
  const key = buildWeatherCacheKey(city, date);
  const entry = weatherCache.get(key);
  if (!entry) return null;
  if (entry.date < date) {
    weatherCache.delete(key);
    return null;
  }
  if (nowMs >= entry.expireAt) {
    weatherCache.delete(key);
    return null;
  }
  return entry.snapshot;
}

function writeWeatherCache(
  city: string,
  snapshot: WeatherSnapshot,
  nowMs: number = Date.now(),
): void {
  ensureWeatherCachePurgeScheduled();
  const date = formatWeatherCacheDate(nowMs);
  const key = buildWeatherCacheKey(city, date);
  weatherCache.set(key, {
    snapshot,
    date,
    expireAt: nowMs + WEATHER_CACHE_TTL_MS,
  });
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
  const windDir = snapshot.windDirection?.trim() || '';
  const windPower = snapshot.windPower?.trim() || '';
  const wind = windDir || windPower ? `，${windDir}${windPower}` : '';
  const humidity = snapshot.humidity?.trim() ? `，湿度${snapshot.humidity}%` : '';
  const time = snapshot.reportTime?.trim();
  const timeSuffix = time ? `（${time}）` : '';

  return `${city}，${weather}，${temperature}℃${wind}${humidity}${timeSuffix}`;
}

async function uapiGet<T>(path: string, params: Record<string, string>): Promise<T | null> {
  const url = new URL(`${UAPI_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v) url.searchParams.set(k, v);
  }

  const headers: Record<string, string> = { Accept: 'application/json' };
  const key = getApiKey();
  if (key) headers.Authorization = `Bearer ${key}`;

  try {
    const res = await fetch(url.toString(), { headers });
    if (!res.ok) {
      console.warn(`[UAPI_WEATHER] HTTP ${res.status} for ${path}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (error) {
    console.warn(`[UAPI_WEATHER] Request failed for ${path}:`, error);
    return null;
  }
}

interface UapiWeatherResponse {
  province?: string;
  city?: string;
  district?: string;
  adcode?: string;
  weather?: string;
  temperature?: number | string;
  wind_direction?: string;
  wind_power?: string;
  humidity?: number | string;
  report_time?: string;
  code?: string;
  message?: string;
}

interface UapiIpInfoResponse {
  ip?: string;
  region?: string;
  code?: string;
  message?: string;
}

/** 从「中国 江苏 南京」一类 region 里取出城市名。 */
export function parseCityFromIpRegion(region: string | undefined): string | null {
  if (!region?.trim()) return null;
  const parts = region
    .trim()
    .split(/[\s,，/|]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  // 常见：国家 省 市 → 取最后一段；已是单段城市名则直接用
  const candidate = parts[parts.length - 1] ?? '';
  const cleaned = candidate.replace(/(特别行政区|自治区|壮族|回族|维吾尔|市|地区|盟)$/g, '').trim();
  return cleaned || candidate || null;
}

function toSnapshot(data: UapiWeatherResponse): WeatherSnapshot | null {
  const weather = data.weather?.trim() ?? '';
  const temperature =
    data.temperature === undefined || data.temperature === null
      ? ''
      : String(data.temperature).trim();
  if (!weather && !temperature) {
    console.warn('[UAPI_WEATHER] Empty or incomplete weather payload');
    return null;
  }

  const humidity =
    data.humidity === undefined || data.humidity === null ? '' : String(data.humidity).trim();

  return {
    city: data.city?.trim() || data.district?.trim() || '',
    province: data.province?.trim() || '',
    weather,
    temperature,
    windDirection: data.wind_direction?.trim() || '',
    windPower: data.wind_power?.trim() || '',
    humidity,
    reportTime: data.report_time?.trim() || '',
  };
}

/** 按城市名查实时天气（UAPI 直接支持中文/英文城市名）。命中 `城市|今天` 且未过 TTL 则走缓存。 */
export async function fetchWeatherByCity(city: string): Promise<WeatherSnapshot | null> {
  const keyword = city.trim();
  if (!keyword) return null;

  const cached = readWeatherCache(keyword);
  if (cached) return cached;

  const data = await uapiGet<UapiWeatherResponse>('/misc/weather', {
    city: keyword,
    lang: 'zh',
  });
  if (!data || data.code) return null;
  const snapshot = toSnapshot(data);
  if (snapshot) writeWeatherCache(keyword, snapshot);
  return snapshot;
}

/** @deprecated 兼容旧测试名：UAPI 用城市名直查，不再需要 adcode。 */
export async function resolveAdcodeByCity(city: string): Promise<string | null> {
  const keyword = city.trim().replace(/市$/, '');
  if (!keyword) return null;
  // 保留签名：有城市即可；实际天气走 city 参数
  return keyword;
}

/** @deprecated 兼容旧测试名：底层改为 UAPI weather by adcode。 */
export async function fetchLiveWeather(adcode: string): Promise<WeatherSnapshot | null> {
  const code = adcode.trim();
  if (!code) return null;

  const data = await uapiGet<UapiWeatherResponse>('/misc/weather', {
    adcode: code,
    lang: 'zh',
  });
  if (!data || data.code) return null;
  return toSnapshot(data);
}

export async function resolveLocationByIp(ip: string): Promise<AmapLocation | null> {
  if (isLocalOrPrivateIp(ip)) {
    console.log('[UAPI_WEATHER] Skipping IP lookup for local/private IP');
    return null;
  }

  const data = await uapiGet<UapiIpInfoResponse>('/network/ipinfo', { ip: ip.trim() });
  if (!data || data.code) return null;

  const city = parseCityFromIpRegion(data.region);
  if (!city) return null;

  return { city, adcode: '' };
}

export async function enrichWeather(opts: {
  city?: string;
  ip?: string;
}): Promise<string> {
  try {
    if (opts.city?.trim()) {
      const snapshot = await fetchWeatherByCity(opts.city);
      if (snapshot) return formatWeatherSnapshot(snapshot);
    }

    if (opts.ip && !isLocalOrPrivateIp(opts.ip)) {
      const location = await resolveLocationByIp(opts.ip);
      if (location?.city) {
        const snapshot = await fetchWeatherByCity(location.city);
        if (snapshot) return formatWeatherSnapshot(snapshot);
      }
    }
  } catch (error) {
    console.warn('[UAPI_WEATHER] enrichWeather failed:', error);
  }

  return '';
}
