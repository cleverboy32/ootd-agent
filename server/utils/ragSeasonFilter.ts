import type { DressingClimate, GatekeeperIntent } from '@/server/agents/intent';
import {
  inferDressingClimateFromAnchor,
  isAnchorPairingIntent,
  parseDressingClimate,
} from '@/server/agents/intent';
import type { WardrobeSearchResult } from '@/server/services/wardrobeService';
import type { WardrobeSearchSlot } from '@/server/utils/ragSearchSlots';

export type ClothingSeason = 'spring' | 'summer' | 'autumn' | 'winter';

export interface SeasonFilterContext {
  targetSeasons: ClothingSeason[];
  isWarmWeather: boolean;
  /** 滑雪等严寒户外场合，下装须含 winter */
  strictColdActivity: boolean;
  dressingClimate: DressingClimate;
}

const ALL_SEASONS: ClothingSeason[] = ['spring', 'summer', 'autumn', 'winter'];

const STRICT_COLD_ACTIVITY_HINT = /滑雪|滑雪服|雪场|雪地|skiing|snowboard|snow sports/i;

const HEAVY_WINTER_SUBCATEGORY = /puffer|down jacket|down coat|parka|padded boot|quilted.*jacket/i;

function normalizeSeason(value: string): ClothingSeason | null {
  const s = value.trim().toLowerCase();
  if (s === 'spring' || s === 'summer' || s === 'autumn' || s === 'fall' || s === 'winter') {
    return s === 'fall' ? 'autumn' : (s as ClothingSeason);
  }
  return null;
}

function normalizeItemSeasons(itemSeasons: string[]): ClothingSeason[] {
  return itemSeasons
    .map(normalizeSeason)
    .filter((s): s is ClothingSeason => s !== null);
}

function hasWinter(seasons: ClothingSeason[]): boolean {
  return seasons.includes('winter');
}

function hasSummer(seasons: ClothingSeason[]): boolean {
  return seasons.includes('summer');
}

export function parseTemperatureCelsius(weather: string): number | null {
  const match = weather.match(/(-?\d+)\s*(?:°\s*c|℃)/i);
  return match ? Number.parseInt(match[1], 10) : null;
}

export function inferClimateFromWeather(weather: string): DressingClimate | '' {
  const normalized = weather.trim();
  if (!normalized) return '';

  const temp = parseTemperatureCelsius(normalized);
  if (temp !== null) {
    if (temp >= 22) return 'warm';
    if (temp <= 12) return 'cold';
    return 'mild';
  }

  if (/冬|寒冷|下雪|保暖|冷/i.test(normalized)) return 'cold';
  if (/夏|炎热|热/i.test(normalized)) return 'warm';
  return '';
}

function buildActivityText(intent?: GatekeeperIntent, userMessage?: string): string {
  return [intent?.occasion, intent?.special_requests, userMessage].filter(Boolean).join(' ');
}

function climatesConflict(a: DressingClimate, b: DressingClimate): boolean {
  return (a === 'cold' && b === 'warm') || (a === 'warm' && b === 'cold');
}

function shouldAnchorOverrideWeather(
  intent: GatekeeperIntent,
  anchor: DressingClimate,
  weather: DressingClimate
): boolean {
  if (anchor === weather) return false;
  if (isAnchorPairingIntent(intent)) return true;
  return climatesConflict(anchor, weather);
}

function inferClimateFromActivity(intent: GatekeeperIntent, userMessage?: string): DressingClimate | '' {
  const activityText = buildActivityText(intent, userMessage);
  if (!STRICT_COLD_ACTIVITY_HINT.test(activityText)) return '';

  const temp = intent.weather?.trim() ? parseTemperatureCelsius(intent.weather) : null;
  if (temp !== null && temp >= 22) return '';

  return 'cold';
}

function climateFromParsedTemperature(temp: number): DressingClimate {
  if (temp >= 22) return 'warm';
  if (temp <= 12) return 'cold';
  return 'mild';
}

/**
 * 服务端统一计算 dressing_climate（忽略 Gatekeeper LLM 推断）。
 * 优先级：实况温度 > 严寒活动（滑雪等）> 天气关键词 > 锚点单品 > 留空（日历兜底）。
 * 锚点配对时，锚点与天气不一致则以锚点为准。
 */
export function computeDressingClimate(
  intent: GatekeeperIntent,
  userMessage?: string
): DressingClimate | '' {
  const fromAnchor = inferDressingClimateFromAnchor(intent);
  const weatherText = intent.weather?.trim() ?? '';
  const parsedTemp = weatherText ? parseTemperatureCelsius(weatherText) : null;
  const fromWeatherTemp = parsedTemp !== null ? climateFromParsedTemperature(parsedTemp) : '';
  const fromWeatherKeyword =
    weatherText && parsedTemp === null ? inferClimateFromWeather(weatherText) : '';
  const fromActivity = inferClimateFromActivity(intent, userMessage);

  if (fromWeatherTemp) {
    if (fromAnchor && shouldAnchorOverrideWeather(intent, fromAnchor, fromWeatherTemp)) {
      return fromAnchor;
    }
    return fromWeatherTemp;
  }

  if (fromActivity) {
    if (fromAnchor && climatesConflict(fromActivity, fromAnchor)) return fromAnchor;
    return fromActivity;
  }

  if (fromWeatherKeyword) return fromWeatherKeyword;
  if (fromAnchor) return fromAnchor;

  return '';
}

/** 写入 intent.dressing_climate；无天气/锚点/活动时清空 Gatekeeper 猜测值。 */
export function resolveDressingClimateForIntent(
  intent: GatekeeperIntent,
  userMessage?: string
): GatekeeperIntent {
  const resolved = computeDressingClimate(intent, userMessage);

  if (!resolved) {
    if (parseDressingClimate(intent.dressing_climate)) {
      console.log('[CLIMATE] Clearing Gatekeeper dressing_climate (server derives from weather/anchor)');
      return { ...intent, dressing_climate: '' };
    }
    return intent;
  }

  if (intent.dressing_climate === resolved) return intent;

  console.log(
    `[CLIMATE] dressing_climate: ${intent.dressing_climate || '(empty)'} → ${resolved}`
  );
  return { ...intent, dressing_climate: resolved };
}

/** @deprecated 使用 resolveDressingClimateForIntent */
export function applyWeatherToDressingClimate(intent: GatekeeperIntent): GatekeeperIntent {
  return resolveDressingClimateForIntent(intent);
}

function resolveDressingClimate(intent?: GatekeeperIntent, userMessage?: string): DressingClimate {
  if (!intent) return 'mild';
  return computeDressingClimate(intent, userMessage) || 'mild';
}

/** 东八区日历季：3–5 春 / 6–8 夏 / 9–11 秋 / 12–2 冬 */
export function calendarSeasonFromDate(date: Date = new Date()): ClothingSeason {
  const month = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai',
      month: 'numeric',
    }).format(date)
  );
  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 9 && month <= 11) return 'autumn';
  return 'winter';
}

/** 无实况天气时的 mild 日历兜底：不再四季全开 */
export function calendarFallbackSeasonContext(
  activityText: string,
  now: Date = new Date()
): SeasonFilterContext {
  const season = calendarSeasonFromDate(now);
  const strictColdActivity = STRICT_COLD_ACTIVITY_HINT.test(activityText);

  switch (season) {
    case 'summer':
      return {
        dressingClimate: 'warm',
        targetSeasons: ['spring', 'summer'],
        isWarmWeather: true,
        strictColdActivity: false,
      };
    case 'winter':
      return {
        dressingClimate: 'cold',
        targetSeasons: ['autumn', 'winter'],
        isWarmWeather: false,
        strictColdActivity,
      };
    case 'spring':
      return {
        dressingClimate: 'mild',
        targetSeasons: ['spring', 'summer'],
        isWarmWeather: false,
        strictColdActivity,
      };
    case 'autumn':
      return {
        dressingClimate: 'mild',
        targetSeasons: ['autumn', 'winter'],
        isWarmWeather: false,
        strictColdActivity,
      };
  }
}

function climateToSeasonContext(
  dressingClimate: DressingClimate,
  activityText: string
): SeasonFilterContext {
  switch (dressingClimate) {
    case 'cold':
      return {
        dressingClimate,
        targetSeasons: ['autumn', 'winter'],
        isWarmWeather: false,
        strictColdActivity: STRICT_COLD_ACTIVITY_HINT.test(activityText),
      };
    case 'warm':
      return {
        dressingClimate,
        targetSeasons: ['spring', 'summer'],
        isWarmWeather: true,
        strictColdActivity: false,
      };
    default:
      return {
        dressingClimate: 'mild',
        targetSeasons: ALL_SEASONS,
        isWarmWeather: false,
        strictColdActivity: STRICT_COLD_ACTIVITY_HINT.test(activityText),
      };
  }
}

/** Build RAG season filter from server-resolved dressing_climate (weather / anchor / calendar). */
export function buildSeasonFilterContext(
  intent?: GatekeeperIntent,
  userMessage?: string,
  now: Date = new Date()
): SeasonFilterContext {
  const dressingClimate = resolveDressingClimate(intent, userMessage);
  const activityText = buildActivityText(intent, userMessage);

  if (dressingClimate === 'mild' && !intent?.weather?.trim()) {
    return calendarFallbackSeasonContext(activityText, now);
  }

  return climateToSeasonContext(dressingClimate, activityText);
}

function isHeavyWinterItem(item: WardrobeSearchResult): boolean {
  const sub = item.subCategory.toLowerCase();
  const desc = (item.description ?? '').toLowerCase();
  return HEAVY_WINTER_SUBCATEGORY.test(sub) || HEAVY_WINTER_SUBCATEGORY.test(desc);
}

function seasonsOverlap(itemSeasons: string[], targetSeasons: ClothingSeason[]): boolean {
  if (itemSeasons.length === 0) return true;
  const normalized = normalizeItemSeasons(itemSeasons);
  if (normalized.length === 0) return true;
  return normalized.some((s) => targetSeasons.includes(s));
}

function isWinterOnly(itemSeasons: string[]): boolean {
  const normalized = normalizeItemSeasons(itemSeasons);
  return normalized.length > 0 && normalized.every((s) => s === 'winter');
}

function shouldExcludeInColdWeather(
  itemSeasons: string[],
  context: SeasonFilterContext,
  slot?: WardrobeSearchSlot
): boolean {
  const normalized = normalizeItemSeasons(itemSeasons);
  if (normalized.length === 0) return false;

  if (hasSummer(normalized) && !hasWinter(normalized)) {
    return true;
  }

  if (context.strictColdActivity && slot === 'bottom' && !hasWinter(normalized)) {
    return true;
  }

  return false;
}

function isNarrowMildContext(context: SeasonFilterContext): boolean {
  return (
    context.dressingClimate === 'mild' &&
    context.targetSeasons.length > 0 &&
    context.targetSeasons.length < ALL_SEASONS.length
  );
}

export function shouldExcludeBySeason(
  item: WardrobeSearchResult,
  context: SeasonFilterContext,
  slot?: WardrobeSearchSlot
): boolean {
  // 真·mild（四季）且非严寒活动：不过滤
  if (context.dressingClimate === 'mild' && !context.strictColdActivity && !isNarrowMildContext(context)) {
    return false;
  }

  const itemSeasons = item.season ?? [];

  if (!seasonsOverlap(itemSeasons, context.targetSeasons)) {
    return true;
  }

  // 日历收窄后的 mild（如春=春夏）：只做季节交集，不做暖季重冬装规则
  if (isNarrowMildContext(context) && !context.strictColdActivity) {
    return false;
  }

  if (!context.isWarmWeather) {
    if (context.dressingClimate === 'mild' && context.strictColdActivity) {
      return shouldExcludeInColdWeather(itemSeasons, context, slot);
    }
    return shouldExcludeInColdWeather(itemSeasons, context, slot);
  }

  if (isWinterOnly(itemSeasons)) {
    return true;
  }

  const slotIsOuterwear = slot === 'outerwear' || item.mainCategory === 'OUTERWEAR';
  const slotIsFootwear = slot === 'shoes' || item.mainCategory === 'FOOTWEAR';

  if (slotIsOuterwear && isHeavyWinterItem(item)) {
    return true;
  }

  if (slotIsFootwear && isHeavyWinterItem(item)) {
    return true;
  }

  return false;
}

export function applySeasonFilter(
  results: WardrobeSearchResult[],
  context: SeasonFilterContext,
  slot?: WardrobeSearchSlot,
  limit = 5
): WardrobeSearchResult[] {
  const filtered = results.filter((item) => !shouldExcludeBySeason(item, context, slot));
  if (filtered.length > 0) {
    return filtered.slice(0, limit);
  }

  if (!context.isWarmWeather && context.dressingClimate !== 'mild') {
    const hadSeasonExclusions = results.some((item) =>
      shouldExcludeBySeason(item, context, slot)
    );
    if (hadSeasonExclusions) {
      return [];
    }
  }

  return results.slice(0, limit);
}

export function expandedSearchLimit(_context: SeasonFilterContext, defaultLimit: number): number {
  return Math.max(defaultLimit * 2, 10);
}

export { ALL_SEASONS };
