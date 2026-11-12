/**
 * 三明治各槽目标适穿区间：与 weather-dressing / 衣橱分析 tempMin·tempMax 同语义（单件适穿）。
 * 过滤规则：单品区间与槽位目标区间求交；双空旧单品放行。
 */

import type { WardrobeSearchSlot } from '@/server/utils/ragSearchSlots';

export type WeatherDressBand =
  | 'hot'
  | 'warm'
  | 'comfort'
  | 'mild_cool'
  | 'cool'
  | 'cold'
  | 'freezing';

export type TempRange = { min: number | null; max: number | null };

/** 厚薄层级 → 单件适穿 ℃（与 wardrobeAnalysis 口径对齐） */
export const THICKNESS_TEMP_RANGES = {
  thin_top_short: { min: 22, max: null },
  thin_top_long: { min: 12, max: 22 },
  warm_top: { min: 5, max: 15 },
  thin_outer: { min: 13, max: 25 },
  mid_outer: { min: 8, max: 17 },
  thick_outer: { min: null, max: 12 },
  thin_bottom: { min: 20, max: null },
  regular_bottom: { min: 16, max: 26 },
  thick_bottom: { min: 10, max: 20 },
  thin_tights: { min: 15, max: 22 },
  thick_tights: { min: null, max: 15 },
} as const satisfies Record<string, TempRange>;

export type ThicknessTier = keyof typeof THICKNESS_TEMP_RANGES;

type SlotTierMap = Partial<Record<WardrobeSearchSlot | 'top' | 'bottom' | 'dress' | 'outerwear' | 'shoes' | 'accessory', ThicknessTier | null>>;

/** 环境档 → 各槽选用的厚薄层级（null = 该槽本档不检索/不过滤） */
const BAND_SLOT_TIERS: Record<WeatherDressBand, SlotTierMap> = {
  hot: {
    top: 'thin_top_short',
    bottom: 'thin_bottom',
    dress: 'thin_bottom',
    outerwear: null,
    accessory: null,
    shoes: null,
  },
  warm: {
    top: 'thin_top_short',
    bottom: 'thin_bottom',
    dress: 'thin_bottom',
    outerwear: 'thin_outer',
    accessory: null,
    shoes: null,
  },
  comfort: {
    top: 'thin_top_long',
    bottom: 'regular_bottom',
    dress: 'regular_bottom',
    outerwear: 'thin_outer',
    accessory: null,
    shoes: null,
  },
  mild_cool: {
    top: 'thin_top_long',
    bottom: 'regular_bottom',
    dress: 'regular_bottom',
    outerwear: 'thin_outer',
    accessory: 'thin_tights',
    shoes: null,
  },
  cool: {
    top: 'warm_top',
    bottom: 'thick_bottom',
    dress: 'thick_bottom',
    outerwear: 'mid_outer',
    accessory: 'thin_tights',
    shoes: null,
  },
  cold: {
    top: 'warm_top',
    bottom: 'thick_bottom',
    dress: 'thick_bottom',
    outerwear: 'thick_outer',
    accessory: 'thick_tights',
    shoes: null,
  },
  freezing: {
    top: 'warm_top',
    bottom: 'thick_bottom',
    dress: 'thick_bottom',
    outerwear: 'thick_outer',
    accessory: 'thick_tights',
    shoes: null,
  },
};

/** 与 weather-dressing / weatherQueryGuard 同一套 ℃ 分档 */
export function resolveWeatherDressBand(temperatureCelsius: number): WeatherDressBand {
  if (temperatureCelsius >= 28) return 'hot';
  if (temperatureCelsius >= 26) return 'warm';
  if (temperatureCelsius >= 22) return 'comfort';
  if (temperatureCelsius >= 18) return 'mild_cool';
  if (temperatureCelsius >= 13) return 'cool';
  if (temperatureCelsius >= 8) return 'cold';
  return 'freezing';
}

/**
 * 从 weather 文本解析 ℃。支持单值与区间（取中点）。
 * 例：18℃、约18-22℃、15～20度
 */
export function parseTemperatureCelsius(weather: string): number | null {
  const normalized = weather.trim();
  if (!normalized) return null;

  const range = normalized.match(
    /(-?\d+)\s*(?:℃|°\s*c|度)?\s*[~～\-—–至到]\s*(-?\d+)\s*(?:℃|°\s*c|度)?/i
  );
  if (range) {
    const a = Number.parseInt(range[1], 10);
    const b = Number.parseInt(range[2], 10);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return Math.round((a + b) / 2);
  }

  const single = normalized.match(/(-?\d+)\s*(?:℃|°\s*c|度)/i);
  if (!single) return null;
  const value = Number.parseInt(single[1], 10);
  return Number.isFinite(value) ? value : null;
}

export function resolveSlotTempFilter(
  band: WeatherDressBand,
  slot?: string | null
): TempRange | null {
  if (!slot) return null;
  const tier = BAND_SLOT_TIERS[band][slot as WardrobeSearchSlot];
  if (tier === undefined || tier === null) return null;
  return { ...THICKNESS_TEMP_RANGES[tier] };
}

export function resolveSlotTempFilterFromWeather(
  weather: string,
  slot?: string | null
): TempRange | null {
  const temp = parseTemperatureCelsius(weather);
  if (temp === null) return null;
  return resolveSlotTempFilter(resolveWeatherDressBand(temp), slot);
}

/** 单品区间与目标区间是否有交集；双空旧单品放行 */
export function itemOverlapsTempRange(
  item: { tempMin?: number | null; tempMax?: number | null },
  target: TempRange
): boolean {
  const itemMin = item.tempMin ?? null;
  const itemMax = item.tempMax ?? null;
  if (itemMin === null && itemMax === null) return true;

  const a0 = itemMin ?? Number.NEGATIVE_INFINITY;
  const a1 = itemMax ?? Number.POSITIVE_INFINITY;
  const b0 = target.min ?? Number.NEGATIVE_INFINITY;
  const b1 = target.max ?? Number.POSITIVE_INFINITY;
  return a0 <= b1 && a1 >= b0;
}

export function applySlotTemperatureFilter<
  T extends { tempMin?: number | null; tempMax?: number | null },
>(results: T[], target: TempRange | null): T[] {
  if (!target) return results;
  return results.filter((item) => itemOverlapsTempRange(item, target));
}

/** 东八区日历季代表温度（Gatekeeper 兜底文案用中点所在区间） */
export function calendarSeasonTempHint(date: Date = new Date()): string {
  const month = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai',
      month: 'numeric',
    }).format(date)
  );
  if (month >= 3 && month <= 5) return '约15-20℃';
  if (month >= 6 && month <= 8) return '约26-30℃';
  if (month >= 9 && month <= 11) return '约12-18℃';
  return '约0-8℃';
}

export function formatShanghaiDateHint(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(date);
  const year = parts.find((p) => p.type === 'year')?.value ?? '';
  const month = parts.find((p) => p.type === 'month')?.value ?? '';
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  const seasonHint = calendarSeasonTempHint(date);
  return `今天（东八区）是 ${year}年${month}月${day}日；若需按当前季节段给温度，可用 ${seasonHint}。`;
}
