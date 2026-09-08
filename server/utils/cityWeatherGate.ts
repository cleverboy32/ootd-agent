import type { OutfitRequestType } from '@/server/agents/intent/typeDefs';

const CITY_GATE_REQUEST_TYPES = new Set<OutfitRequestType>([
  'wardrobe_outfit',
  'wardrobe_pairing',
  'purchase_pairing',
]);

export const CITY_WEATHER_FOLLOWUP =
  '方便告诉我您在哪个城市吗？我结合当地天气帮您搭～';

export function requestTypeNeedsCityWeatherGate(requestType: OutfitRequestType): boolean {
  return CITY_GATE_REQUEST_TYPES.has(requestType);
}

/** 已知城市：仅 intent/Gate 填写的 city 与用户档案；不从用户全文正则猜城。 */
export function resolveKnownCity(input: {
  city?: string;
  profileLocation?: string;
}): string {
  return input.city?.trim() || input.profileLocation?.trim() || '';
}

/**
 * 需要查天气、enrich 后仍无 weather、且无城市 → 硬追问城市。
 * IP/城市已查出 weather → 不拦。
 */
export function evaluateCityWeatherGate(input: {
  requestType: OutfitRequestType;
  weatherLookupNeeded: boolean;
  weather: string;
  city?: string;
  profileLocation?: string;
  /** @deprecated 不再用于猜城；保留字段以免调用方立刻报错 */
  contextText?: string;
}): { blocked: boolean; followup?: string } {
  if (!requestTypeNeedsCityWeatherGate(input.requestType)) {
    return { blocked: false };
  }
  if (!input.weatherLookupNeeded) {
    return { blocked: false };
  }
  if (input.weather.trim()) {
    return { blocked: false };
  }
  if (resolveKnownCity(input)) {
    return { blocked: false };
  }
  return { blocked: true, followup: CITY_WEATHER_FOLLOWUP };
}
