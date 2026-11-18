/**
 * 三明治各槽目标适穿区间：与 weather-dressing / 衣橱分析 tempMin·tempMax 同语义（单件适穿）。
 * 硬过滤：单品适穿区间与槽目标区间求交（非中点）。仍注入 query TempSuitable 做软对齐。
 */

import { parseWardrobeSearchSlot, type WardrobeSearchSlot } from '@/server/utils/ragSearchSlots';

/** 环境气温档（与 weather-dressing 中文名：炎热/微暖/舒适/微凉/凉/冷/寒冷） */
export type WeatherDressBand =
  | 'hot' // ≥28℃ 炎热 · 1 层
  | 'warm' // 23–27℃ 微暖 · 1～1.5 层
  | 'comfort' // 18–22℃ 舒适 · 2 层
  | 'mild_cool' // 12–17℃ 微凉 · 2 层
  | 'cool' // 6–11℃ 凉 · 3 层
  | 'cold' // 0–5℃ 冷 · 3 层重磅
  | 'freezing'; // <0℃ 寒冷 · 3～4 层

export type TempRange = { min: number | null; max: number | null };

/** 单侧敞口时推算中点的偏移（℃） */
export const OPEN_TEMP_MID_PAD = 4;

/** 厚薄层级 → 单件适穿 ℃（与衣橱细目表 / wardrobeAnalysis 对齐；每档一个代表区间） */
export const THICKNESS_TEMP_RANGES = {
  thin_top_short: { min: 24, max: 35 }, // 短袖 T/Polo
  thin_top_long: { min: 16, max: 23 }, // 薄长袖打底/薄衬衫（与短袖在 24℃ 切开，无交叠）
  knit_top: { min: 12, max: 20 }, // 薄针织/卫衣（微凉中层或内搭）
  warm_top: { min: 5, max: 14 }, // 加绒卫衣/重磅厚毛衣（初冬～严冬中层）
  thermal_base: { min: -15, max: 4 }, // 薄贴身发热/德绒内衣（严冬～极寒贴身；与 warm_top 在 5℃ 切开）
  thin_outer: { min: 18, max: 25 }, // 薄开衫/薄西装
  spring_jacket: { min: 13, max: 21 }, // 牛仔夹克/垫肩西装（微凉）
  mid_outer: { min: 11, max: 19 }, // 风衣（凉）
  thick_outer: { min: 2, max: 11 }, // 大衣/轻暖羽绒（冷）
  winter_outer: { min: -8, max: 5 }, // 中长羽绒/派克服（寒冷）
  thin_bottom: { min: 24, max: 38 }, // 短裤/迷你短裙
  regular_bottom: { min: 12, max: 23 }, // 常规牛仔裤/休闲西裤（与短裤在 24℃ 切开）
  thick_bottom: { min: 4, max: 11 }, // 羊毛西裤/灯芯绒/毛呢裙（与常规下装 12℃ 切开）
  winter_bottom: { min: -8, max: 6 }, // 加绒裤（冷/寒冷可选）
  thermal_bottom_base: { min: -15, max: 4 }, // 薄贴身速干/发热内搭裤（全长外裤内层；非羊羔绒）
  thin_tights: { min: 15, max: 21 }, // 半透微压～薄丝袜
  thick_tights: { min: -8, max: 14 }, // 加厚春秋袜～加绒打底裤（与 SOCKS 厚腿层对齐）
  thin_shoes: { min: 25, max: 38 }, // 凉鞋/拖鞋/洞洞鞋
  mesh_shoes: { min: 16, max: 34 }, // 帆布/网面运动鞋（偏热）
  regular_shoes: { min: 8, max: 30 }, // 皮面板鞋/德训等休闲厚底
  closed_shoes: { min: 0, max: 15 }, // 切尔西/马丁/短靴
  warm_boots: { min: -20, max: 4 }, // 加绒短靴/雪地靴
} as const satisfies Record<string, TempRange>;

export type ThicknessTier = keyof typeof THICKNESS_TEMP_RANGES;

type SlotTierMap = Partial<
  Record<
    | WardrobeSearchSlot
    | 'top'
    | 'inner_top'
    | 'bottom'
    | 'inner_bottom'
    | 'skirt'
    | 'outerwear'
    | 'shoes'
    | 'legwear'
    | 'accessory',
    ThicknessTier | null
  >
>;

/** 环境档 → 各槽选用的厚薄层级（null = 该槽本档不检索/不过滤） */
const BAND_SLOT_TIERS: Record<WeatherDressBand, SlotTierMap> = {
  // hot：1 层只开 top；warm～mild_cool：2 层 inner+外（无 mid top）；cool～freezing：三层。
  // cold/freezing：开 inner_bottom（全长外裤内薄贴身层）；legwear 留给裙/短/七分可见腿层召回。
  // 鞋：仅炎热/冷极收紧；暖～凉统一 regular_shoes。
  hot: {
    top: 'thin_top_short',
    inner_top: null,
    bottom: 'thin_bottom',
    inner_bottom: null,
    skirt: 'thin_bottom',
    outerwear: null,
    legwear: null,
    accessory: null,
    shoes: 'thin_shoes',
  },
  warm: {
    top: null,
    inner_top: 'thin_top_short',
    bottom: 'thin_bottom',
    inner_bottom: null,
    skirt: 'thin_bottom',
    outerwear: 'thin_outer',
    legwear: null,
    accessory: null,
    shoes: 'regular_shoes',
  },
  comfort: {
    top: null,
    inner_top: 'thin_top_long',
    bottom: 'regular_bottom',
    inner_bottom: null,
    skirt: 'regular_bottom',
    outerwear: 'thin_outer',
    legwear: null,
    accessory: null,
    shoes: 'regular_shoes',
  },
  mild_cool: {
    top: null, // 两层：打底 + 春秋夹克，不开中层
    inner_top: 'thin_top_long',
    bottom: 'regular_bottom',
    inner_bottom: null,
    skirt: 'regular_bottom',
    outerwear: 'spring_jacket',
    legwear: 'thin_tights',
    accessory: null,
    shoes: 'regular_shoes',
  },
  cool: {
    top: 'warm_top',
    inner_top: 'thin_top_long',
    bottom: 'thick_bottom',
    inner_bottom: null,
    skirt: 'thick_bottom',
    outerwear: 'thick_outer',
    legwear: 'thick_tights',
    accessory: null,
    shoes: 'regular_shoes',
  },
  cold: {
    top: 'warm_top',
    inner_top: 'thermal_base',
    bottom: 'winter_bottom',
    inner_bottom: 'thermal_bottom_base',
    skirt: 'winter_bottom',
    outerwear: 'winter_outer',
    legwear: 'thick_tights',
    accessory: null,
    shoes: 'warm_boots',
  },
  freezing: {
    top: 'warm_top',
    inner_top: 'thermal_base',
    bottom: 'winter_bottom',
    inner_bottom: 'thermal_bottom_base',
    skirt: 'winter_bottom',
    outerwear: 'winter_outer',
    legwear: 'thick_tights',
    accessory: null,
    shoes: 'warm_boots',
  },
};

/** 环境气温 → 档位（边界落入较暖档：22→comfort，23→warm，0→cold，-0.1→freezing） */
export function resolveWeatherDressBand(temperatureCelsius: number): WeatherDressBand {
  if (temperatureCelsius >= 28) return 'hot';
  if (temperatureCelsius >= 23) return 'warm';
  if (temperatureCelsius >= 18) return 'comfort';
  if (temperatureCelsius >= 12) return 'mild_cool';
  if (temperatureCelsius >= 6) return 'cool';
  if (temperatureCelsius >= 0) return 'cold';
  return 'freezing';
}

const PLAN_HINT_SLOTS: WardrobeSearchSlot[] = [
  'inner_top',
  'top',
  'outerwear',
  'inner_bottom',
  'bottom',
  'skirt',
  'legwear',
  'shoes',
];

/** null 表示本档天气三明治不开该槽（配饰除外；鞋有温区但仍须开槽） */
const WEATHER_GATE_SLOTS = new Set<WardrobeSearchSlot>([
  'inner_top',
  'top',
  'outerwear',
  'inner_bottom',
  'legwear',
]);

const TIER_THICKNESS_HINT: Record<ThicknessTier, string> = {
  thin_top_short: '短袖T/Polo（约24-35℃）',
  thin_top_long: '薄长袖打底/薄衬衫（约16-23℃）',
  knit_top: '薄针织/卫衣（约12-20℃）',
  warm_top: '加绒卫衣/厚毛衣中层（约5-14℃）',
  thermal_base: '薄贴身发热/德绒底层（约-15-4℃）',
  thin_outer: '薄开衫/薄西装（约18-25℃）',
  spring_jacket: '牛仔夹克/垫肩西装（约13-21℃）',
  mid_outer: '风衣等中厚外套（约11-19℃）',
  thick_outer: '大衣/轻暖羽绒（约2-11℃）',
  winter_outer: '中长羽绒/派克服（约-8-5℃）',
  thin_bottom: '短裤/迷你短裙（约24-38℃）',
  regular_bottom: '常规牛仔裤/西裤（约12-23℃）',
  thick_bottom: '羊毛西裤/毛呢裙（约4-11℃）',
  winter_bottom: '加绒裤（约-8-6℃）',
  thermal_bottom_base: '薄贴身速干/发热内搭裤（约-15-4℃）',
  thin_tights: '薄～半透丝袜（约15-21℃）',
  thick_tights: '加厚春秋袜～加绒打底裤（约-8-14℃）',
  thin_shoes: '凉鞋/拖鞋/洞洞鞋（约25-38℃）',
  mesh_shoes: '帆布/网面运动鞋（约16-34℃）',
  regular_shoes: '皮面板鞋/德训等（约8-30℃）',
  closed_shoes: '切尔西/马丁/短靴（约0-15℃）',
  warm_boots: '加绒靴/雪地靴（约-20-4℃）',
};

function formatTempBound(value: number | null): string {
  return value === null ? '不限' : `${value}`;
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

/** 风力 ≥4 级（明确 ≤3 级不算）→ 体感 −3；湿度>75% 且原气温<10℃ → 体感 −4 */
export function computeFeelsLikeCelsius(
  weather: string,
  tempCelsius: number
): { feelsLikeCelsius: number; adjustments: string[] } {
  const adjustments: string[] = [];
  let feelsLikeCelsius = tempCelsius;

  const weakWind =
    /[≤<]=?\s*3\s*级|3\s*级以下|低于\s*4\s*级|小于\s*4\s*级|风力\s*[≤<]=?\s*3/.test(weather);
  if (!weakWind) {
    const windLevel = weather.match(/(\d+)\s*级/);
    if (windLevel) {
      const level = Number.parseInt(windLevel[1], 10);
      if (Number.isFinite(level) && level >= 4) {
        feelsLikeCelsius -= 3;
        adjustments.push('风力≥4:-3℃');
      }
    }
  }

  const humidity = weather.match(/湿度\s*[：:]?\s*(\d+)\s*%/);
  if (humidity) {
    const pct = Number.parseInt(humidity[1], 10);
    if (Number.isFinite(pct) && pct > 75 && tempCelsius < 10) {
      feelsLikeCelsius -= 4;
      adjustments.push('湿冷(湿度>75%且<10℃):-4℃');
    }
  }

  return { feelsLikeCelsius, adjustments };
}

export function resolveSlotTempFilter(
  band: WeatherDressBand,
  slot?: string | null
): TempRange | null {
  if (!slot) return null;
  const parsed = parseWardrobeSearchSlot(slot) ?? (slot as WardrobeSearchSlot);
  const tier = BAND_SLOT_TIERS[band][parsed];
  if (tier === undefined || tier === null) return null;
  return { ...THICKNESS_TEMP_RANGES[tier] };
}

export type WeatherDressResolution = {
  tempCelsius: number;
  feelsLikeCelsius: number;
  band: WeatherDressBand;
  adjustments: string[];
  planHint: string;
  slotRange: (slot: string | null | undefined) => TempRange | null;
};

function buildPlanHintFromBand(
  tempCelsius: number,
  feelsLikeCelsius: number,
  band: WeatherDressBand,
  adjustments: string[]
): string {
  const lines: string[] = [];
  for (const slot of PLAN_HINT_SLOTS) {
    const tier = BAND_SLOT_TIERS[band][slot];
    if (tier === undefined || tier === null) {
      if (WEATHER_GATE_SLOTS.has(slot)) {
        lines.push(`- ${slot}: 本档不开（禁止写入 plan slots）`);
      }
      continue;
    }
    const range = THICKNESS_TEMP_RANGES[tier];
    lines.push(
      `- ${slot}: 开；层级=${tier}（${TIER_THICKNESS_HINT[tier]}）；适穿℃=[${formatTempBound(range.min)}, ${formatTempBound(range.max)}]（检索 TempSuitable + 区间求交硬过滤）`
    );
  }

  const feelLine =
    adjustments.length > 0
      ? `气温约 ${tempCelsius}℃ → 体感约 ${feelsLikeCelsius}℃（${adjustments.join('；')}）→ 档=${band}`
      : `气温约 ${tempCelsius}℃ → 档=${band}`;

  return [
    '【服务端槽温区表 — 只管天气层次/厚薄】',
    feelLine,
    ...lines,
    '规则：标注「开」的天气槽（上装层次、下装厚薄、裤内层、腿层、鞋温区）须遵守；标注「不开」的上装/裤内层/腿层槽禁止开。成品一套内 bottom（裤）与 skirt（裙装）二选一。全长加绒/滑雪等外裤用 inner_bottom（薄速干/发热内搭裤），禁止再叠羊羔绒 legwear；裙装/短裤/七分裤等外露小腿用 legwear，不开 inner_bottom。无 style 检索骨架可为召回池同时开 bottom+skirt（及表内 inner_bottom/legwear）。shoes 本表只管厚薄温区，槽仍须开。accessory 不在本表：按场合/风格照常可开。target 与 search_query 厚薄用词须与层级一致；禁止自编另一套 ℃。',
  ].join('\n');
}

/**
 * 唯一天气定档入口：解析 ℃ → 体感修正 → 档 → 槽温区 / Plan hint。
 * weather 无法解析 ℃ 时返回 null。
 */
export function resolveDressingFromWeather(weather: string): WeatherDressResolution | null {
  const tempCelsius = parseTemperatureCelsius(weather);
  if (tempCelsius === null) return null;

  const { feelsLikeCelsius, adjustments } = computeFeelsLikeCelsius(weather, tempCelsius);
  const band = resolveWeatherDressBand(feelsLikeCelsius);

  return {
    tempCelsius,
    feelsLikeCelsius,
    band,
    adjustments,
    planHint: buildPlanHintFromBand(tempCelsius, feelsLikeCelsius, band, adjustments),
    slotRange: (slot) => resolveSlotTempFilter(band, slot),
  };
}


/** 单品适穿中点；双空返回 null（诊断/测试用，不参与硬过滤） */
export function itemTempMidpoint(item: {
  tempMin?: number | null;
  tempMax?: number | null;
}): number | null {
  const itemMin = item.tempMin ?? null;
  const itemMax = item.tempMax ?? null;
  if (itemMin === null && itemMax === null) return null;
  if (itemMin !== null && itemMax !== null) return (itemMin + itemMax) / 2;
  if (itemMin !== null) return itemMin + OPEN_TEMP_MID_PAD;
  return (itemMax as number) - OPEN_TEMP_MID_PAD;
}

/**
 * 单品适穿区间与槽目标区间是否相交（含边界）。双空旧单品放行。
 * 不用中点：宽适穿单品只要与槽区间有交就保留。
 */
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
