import { parseTemperatureCelsius } from '@/server/utils/ragSeasonFilter';
import type { WardrobeSearchQuery } from '@/server/utils/ragSearchSlots';

/** Aligns with weather-dressing temperature bands. */
export type WeatherDressBand =
  | 'hot'
  | 'warm'
  | 'comfort'
  | 'mild_cool'
  | 'cool'
  | 'cold'
  | 'freezing';

export type WeatherQueryGuardChange = {
  slot: string;
  from: string;
  to: string;
  reason: string;
};

export type WeatherQueryGuardResult = {
  queries: WardrobeSearchQuery[];
  changes: WeatherQueryGuardChange[];
};

/** Matches weather-dressing thick outers (大衣/棉服/羽绒). Plain 大衣 counts; 薄风衣 does not. */
const HEAVY_OUTER =
  /羽绒|羽绒服|棉服|派克|棉袄|大衣|派克服|puffer|parka|coat(?!\s*dress)/i;
const THIN_OUTER_ONLY =
  /薄外套|薄开衫|薄针织|开衫|衬衫外套|薄风衣|针织开衫|cardigan/i;
const SHORT_TOP = /短袖|无袖|背心|吊带|tank|sleeveless/i;

const NEEDS_THIN_OUTER: WeatherDressBand[] = ['comfort', 'mild_cool', 'cool'];
const NEEDS_THICK_OUTER: WeatherDressBand[] = ['cold', 'freezing'];
const THIN_OUTER_BANDS: WeatherDressBand[] = ['hot', 'warm', 'comfort', 'mild_cool', 'cool'];
const NEEDS_LONG_TOP: WeatherDressBand[] = ['mild_cool', 'cool', 'cold', 'freezing'];

export function resolveWeatherDressBand(weather: string): WeatherDressBand | null {
  const temp = parseTemperatureCelsius(weather.trim());
  if (temp === null) return null;
  if (temp >= 28) return 'hot';
  if (temp >= 26) return 'warm';
  if (temp >= 22) return 'comfort';
  if (temp >= 18) return 'mild_cool';
  if (temp >= 13) return 'cool';
  if (temp >= 8) return 'cold';
  return 'freezing';
}

function userNamedNoOuter(userText: string): boolean {
  return /不要外套|别穿外套|不穿外套|不用外套/.test(userText);
}

function userNamedHeavyOuter(userText: string): boolean {
  return /羽绒|棉服|派克|厚外套|大衣/.test(userText);
}

function userNamedShortTop(userText: string): boolean {
  return /短袖|无袖|吊带|背心/.test(userText);
}

/**
 * Weather guard: sandwich layers + outer thickness only.
 * Does NOT rewrite skirt↔pants or dress routes (style owns those).
 */
export function applyWeatherQueryGuard(
  queries: WardrobeSearchQuery[],
  options: {
    weather: string;
    skillNames?: string[];
    userMessage?: string;
    specialRequests?: string;
  }
): WeatherQueryGuardResult {
  const skillNames = options.skillNames ?? [];
  if (!skillNames.some((name) => name.startsWith('weather-'))) {
    return { queries, changes: [] };
  }

  const band = resolveWeatherDressBand(options.weather);
  if (!band) return { queries, changes: [] };

  const userText = [options.userMessage, options.specialRequests].filter(Boolean).join(' ');
  const changes: WeatherQueryGuardChange[] = [];
  const next: WardrobeSearchQuery[] = [];

  for (const item of queries) {
    const slot = item.slot ?? '';
    const query = item.query;

    if (slot === 'outerwear' && band === 'hot' && !userNamedHeavyOuter(userText)) {
      changes.push({
        slot: 'outerwear',
        from: query,
        to: '',
        reason: `${band}: drop outerwear slot (hot band, no outer layer)`,
      });
      continue;
    }

    if (slot === 'outerwear' && THIN_OUTER_BANDS.includes(band) && !userNamedHeavyOuter(userText)) {
      if (HEAVY_OUTER.test(query)) {
        const rewritten = '薄针织开衫';
        changes.push({
          slot: 'outerwear',
          from: query,
          to: rewritten,
          reason: `${band}: heavy outerwear not in thin outer band`,
        });
        next.push({ ...item, query: rewritten });
        continue;
      }
    }

    if (slot === 'outerwear' && NEEDS_THICK_OUTER.includes(band)) {
      if (THIN_OUTER_ONLY.test(query) && !HEAVY_OUTER.test(query) && !/大衣|风衣|coat|trench/i.test(query)) {
        const rewritten = band === 'freezing' ? '羽绒服' : '大衣';
        changes.push({
          slot: 'outerwear',
          from: query,
          to: rewritten,
          reason: `${band}: outer layer must be thick`,
        });
        next.push({ ...item, query: rewritten });
        continue;
      }
    }

    if (slot === 'top' && NEEDS_LONG_TOP.includes(band) && !userNamedShortTop(userText)) {
      if (SHORT_TOP.test(query)) {
        const rewritten = '长袖针织衫';
        changes.push({
          slot: 'top',
          from: query,
          to: rewritten,
          reason: `${band}: top layer needs longer/warmer coverage`,
        });
        next.push({ ...item, query: rewritten });
        continue;
      }
    }

    next.push(item);
  }

  const outfitIds = [
    ...new Set(next.map((q) => q.outfitId).filter((id): id is string => Boolean(id))),
  ];
  const outfitsNeedingOuter =
    outfitIds.length > 0
      ? outfitIds.filter((id) => !next.some((q) => q.outfitId === id && q.slot === 'outerwear'))
      : next.some((q) => q.slot === 'outerwear')
        ? []
        : [undefined];

  if (!userNamedNoOuter(userText) && outfitsNeedingOuter.length > 0) {
    if (NEEDS_THIN_OUTER.includes(band)) {
      for (const outfitId of outfitsNeedingOuter) {
        next.push({
          slot: 'outerwear',
          query: '薄针织开衫',
          ...(outfitId ? { outfitId } : {}),
        });
        changes.push({
          slot: 'outerwear',
          from: '',
          to: '薄针织开衫',
          reason: `${band}: sandwich requires thin outer layer${outfitId ? ` (${outfitId})` : ''}`,
        });
      }
    } else if (NEEDS_THICK_OUTER.includes(band)) {
      const thick = band === 'freezing' ? '羽绒服' : '大衣';
      for (const outfitId of outfitsNeedingOuter) {
        next.push({
          slot: 'outerwear',
          query: thick,
          ...(outfitId ? { outfitId } : {}),
        });
        changes.push({
          slot: 'outerwear',
          from: '',
          to: thick,
          reason: `${band}: sandwich requires thick outer layer${outfitId ? ` (${outfitId})` : ''}`,
        });
      }
    }
  }

  return { queries: next, changes };
}
