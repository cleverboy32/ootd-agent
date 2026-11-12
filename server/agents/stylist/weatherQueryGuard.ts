import type { WardrobeSearchQuery } from '@/server/utils/ragSearchSlots';
import {
  parseTemperatureCelsius,
  resolveWeatherDressBand as bandFromCelsius,
  type WeatherDressBand,
} from '@/server/utils/slotTempFilter';

export type { WeatherDressBand };

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

/** Thick outers (大衣/蓬松棉服/羽绒). Plain 大衣 counts; 薄风衣 does not. */
const HEAVY_OUTER =
  /羽绒|羽绒服|棉服|派克|棉袄|大衣|派克服|puffer|parka|coat(?!\s*dress)/i;
/** Mid-weight allowed even if HEAVY_OUTER also matches (e.g. 薄棉服). */
const MID_OUTER_OK =
  /摇粒绒|薄棉服|软壳|夹棉|中厚|针织外套|卫衣外套|fleece|softshell/i;
/** Clearly thin-only outer queries that are too light for cool/mid band. */
const THIN_OUTER_ONLY =
  /薄外套|薄开衫|薄针织|开衫|衬衫外套|薄风衣|针织开衫|cardigan/i;
const SHORT_TOP = /短袖|无袖|背心|吊带|tank|sleeveless/i;
const THIN_BOTTOM = /短裤|热裤|短裙|迷你裙|凉鞋裙|骑行裤|shorts|mini\s*skirt/i;
const THICK_BOTTOM_OK = /毛呢|厚牛仔|灯芯绒|加绒|毛裤|呢裤|厚裙|羊毛/i;

const DEFAULT_THIN_OUTER = '薄针织开衫';
const DEFAULT_MID_OUTER = '摇粒绒外套';
const DEFAULT_THICK_BOTTOM = '厚长裤';
const DEFAULT_THICK_TIGHTS = '厚打底袜';

const NEEDS_THIN_OUTER: WeatherDressBand[] = ['comfort', 'mild_cool'];
const NEEDS_MID_OUTER: WeatherDressBand[] = ['cool'];
const NEEDS_THICK_OUTER: WeatherDressBand[] = ['cold', 'freezing'];
/** Bands where heavy outers (羽绒/厚大衣) must be rewritten down. */
const FORBID_HEAVY_OUTER: WeatherDressBand[] = [
  'hot',
  'warm',
  'comfort',
  'mild_cool',
  'cool',
];
const NEEDS_LONG_TOP: WeatherDressBand[] = ['mild_cool', 'cool', 'cold', 'freezing'];
const NEEDS_WARM_BOTTOM: WeatherDressBand[] = ['cool', 'cold', 'freezing'];
const NEEDS_LEG_LAYER: WeatherDressBand[] = ['cool', 'cold', 'freezing'];

/** 从 weather 文本解析 ℃ 并落入温度档；无法解析则 null */
export function resolveWeatherDressBand(weather: string): WeatherDressBand | null {
  const temp = parseTemperatureCelsius(weather.trim());
  if (temp === null) return null;
  return bandFromCelsius(temp);
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

function userNamedThinBottom(userText: string): boolean {
  return /短裤|短裙|迷你裙|热裤/.test(userText);
}

function isHeavyForbiddenInBand(query: string, band: WeatherDressBand): boolean {
  if (!HEAVY_OUTER.test(query)) return false;
  if (band === 'cool' && MID_OUTER_OK.test(query)) return false;
  return true;
}

function looksLikeSkirtRoute(query: string): boolean {
  return /裙|dress|skirt/i.test(query);
}

/**
 * Weather guard: sandwich layers + thickness for top/outer/bottom.
 * Runs whenever weather contains a parseable ℃ (不依赖 weather skill 是否选中).
 * Does NOT rewrite skirt↔pants routes (style owns those); cold skirt must get leg layer.
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

    if (
      slot === 'outerwear' &&
      FORBID_HEAVY_OUTER.includes(band) &&
      !userNamedHeavyOuter(userText) &&
      isHeavyForbiddenInBand(query, band)
    ) {
      const rewritten = NEEDS_MID_OUTER.includes(band) ? DEFAULT_MID_OUTER : DEFAULT_THIN_OUTER;
      changes.push({
        slot: 'outerwear',
        from: query,
        to: rewritten,
        reason: `${band}: heavy outerwear not allowed in this band`,
      });
      next.push({ ...item, query: rewritten });
      continue;
    }

    if (
      slot === 'outerwear' &&
      NEEDS_MID_OUTER.includes(band) &&
      THIN_OUTER_ONLY.test(query) &&
      !MID_OUTER_OK.test(query) &&
      !HEAVY_OUTER.test(query)
    ) {
      changes.push({
        slot: 'outerwear',
        from: query,
        to: DEFAULT_MID_OUTER,
        reason: `${band}: outer layer must be mid-weight`,
      });
      next.push({ ...item, query: DEFAULT_MID_OUTER });
      continue;
    }

    if (slot === 'outerwear' && NEEDS_THICK_OUTER.includes(band)) {
      if (
        (THIN_OUTER_ONLY.test(query) || MID_OUTER_OK.test(query)) &&
        !HEAVY_OUTER.test(query) &&
        !/大衣|风衣|coat|trench/i.test(query)
      ) {
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

    if (
      (slot === 'bottom' || slot === 'dress') &&
      NEEDS_WARM_BOTTOM.includes(band) &&
      !userNamedThinBottom(userText) &&
      THIN_BOTTOM.test(query) &&
      !THICK_BOTTOM_OK.test(query)
    ) {
      const rewritten = slot === 'dress' ? '厚连衣裙' : DEFAULT_THICK_BOTTOM;
      changes.push({
        slot,
        from: query,
        to: rewritten,
        reason: `${band}: bottom layer too thin for band`,
      });
      next.push({ ...item, query: rewritten });
      continue;
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
          query: DEFAULT_THIN_OUTER,
          ...(outfitId ? { outfitId } : {}),
        });
        changes.push({
          slot: 'outerwear',
          from: '',
          to: DEFAULT_THIN_OUTER,
          reason: `${band}: sandwich requires thin outer layer${outfitId ? ` (${outfitId})` : ''}`,
        });
      }
    } else if (NEEDS_MID_OUTER.includes(band)) {
      for (const outfitId of outfitsNeedingOuter) {
        next.push({
          slot: 'outerwear',
          query: DEFAULT_MID_OUTER,
          ...(outfitId ? { outfitId } : {}),
        });
        changes.push({
          slot: 'outerwear',
          from: '',
          to: DEFAULT_MID_OUTER,
          reason: `${band}: sandwich requires mid-weight outer layer${outfitId ? ` (${outfitId})` : ''}`,
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

  // 凉及以下裙装：补腿部保暖 accessory（厚打底袜）
  if (NEEDS_LEG_LAYER.includes(band)) {
    const skirtOutfitIds =
      outfitIds.length > 0
        ? outfitIds.filter((id) =>
            next.some(
              (q) =>
                q.outfitId === id &&
                (q.slot === 'dress' || (q.slot === 'bottom' && looksLikeSkirtRoute(q.query)))
            )
          )
        : next.some(
              (q) => q.slot === 'dress' || (q.slot === 'bottom' && looksLikeSkirtRoute(q.query))
            )
          ? [undefined]
          : [];

    for (const outfitId of skirtOutfitIds) {
      const hasLeg = next.some(
        (q) =>
          (outfitId ? q.outfitId === outfitId : true) &&
          q.slot === 'accessory' &&
          /袜|打底|tights|pantyhose|stockings/i.test(q.query)
      );
      if (hasLeg) continue;
      next.push({
        slot: 'accessory',
        query: DEFAULT_THICK_TIGHTS,
        ...(outfitId ? { outfitId } : {}),
      });
      changes.push({
        slot: 'accessory',
        from: '',
        to: DEFAULT_THICK_TIGHTS,
        reason: `${band}: skirt/dress route needs leg layer${outfitId ? ` (${outfitId})` : ''}`,
      });
    }
  }

  return { queries: next, changes };
}
