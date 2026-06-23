import type { DressingClimate, GatekeeperIntent } from '@/server/agents/intent';
import { parseDressingClimate } from '@/server/agents/intent';
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

function parseTemperatureCelsius(weather: string): number | null {
  const match = weather.match(/(-?\d+)\s*°?\s*c/i);
  return match ? Number.parseInt(match[1], 10) : null;
}

function inferClimateFromWeather(weather: string): DressingClimate | '' {
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

function resolveDressingClimate(intent?: GatekeeperIntent): DressingClimate {
  const fromGatekeeper = parseDressingClimate(intent?.dressing_climate);
  if (fromGatekeeper) return fromGatekeeper;

  const fromWeather = intent?.weather ? inferClimateFromWeather(intent.weather) : '';
  if (fromWeather) return fromWeather;

  return 'mild';
}

function buildActivityText(intent?: GatekeeperIntent, userMessage?: string): string {
  return [intent?.occasion, intent?.special_requests, userMessage].filter(Boolean).join(' ');
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

/** Build RAG season filter from Gatekeeper dressing_climate (primary) and weather (fallback). */
export function buildSeasonFilterContext(
  intent?: GatekeeperIntent,
  userMessage?: string
): SeasonFilterContext {
  const dressingClimate = resolveDressingClimate(intent);
  const activityText = buildActivityText(intent, userMessage);
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

export function shouldExcludeBySeason(
  item: WardrobeSearchResult,
  context: SeasonFilterContext,
  slot?: WardrobeSearchSlot
): boolean {
  if (context.dressingClimate === 'mild' && !context.strictColdActivity) {
    return false;
  }

  const itemSeasons = item.season ?? [];

  if (!seasonsOverlap(itemSeasons, context.targetSeasons)) {
    return true;
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
